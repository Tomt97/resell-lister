// Looks at the item photos and writes a listing for each marketplace.
// Runs in the browser with the user's own Claude API key (kept in this browser only).
import Anthropic from "./vendor/anthropic-sdk.js";

export const MODEL = "claude-opus-5-5";
const MAX_PHOTOS_SENT = 8;

const str = { type: "string" };
const strList = { type: "array", items: str };
const obj = (properties) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

export const LISTING_SCHEMA = obj({
  overview: obj({
    title: str,
    description: str,
    condition: { type: "string", enum: ["New with tags", "New without tags", "Like new", "Good", "Fair", "Poor"] },
    category: str,
    brand: str,
    size: str,
    colors: strList,
    style_tags: strList,
    material: str,
    flaws: strList,
  }),
  ebay: obj({
    title: str,
    category_path: str,
    condition: str,
    item_specifics: { type: "array", items: obj({ name: str, value: str }) },
    description: str,
  }),
  poshmark: obj({
    title: str,
    department: str,
    category: str,
    subcategory: str,
    condition: { type: "string", enum: ["New With Tags", "Like New", "Good", "Fair"] },
    colors: strList,
    style_tags: strList,
  }),
  vinted: obj({
    title: str,
    category_path: str,
    condition: {
      type: "string",
      enum: ["New with tags", "New without tags", "Very good", "Good", "Satisfactory"],
    },
    colors: strList,
  }),
  pricing: obj({
    suggested_price: { type: "number" },
    quick_sale_price: { type: "number" },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
    reasoning: str,
  }),
  check_before_posting: strList,
});

export const DESCRIPTION_STYLES = {
  friendly: "Friendly and scannable: 3 to 8 short lines.",
  short: "Short and simple: 2 to 4 short lines, facts only.",
  detailed: "Detailed: 6 to 12 lines covering features, fit, fabric/material, condition and care.",
};

const SYSTEM = `You are an expert US reseller who writes listings that sell on eBay, Poshmark and Vinted.
You are given photos of one item, the seller's asking price, optional seller notes and a description style.
"overview" is the shared listing used on every marketplace; the per-marketplace objects hold what has to
differ there (titles tuned to each site, their own category menus and condition wording). Brand, size and
description are shared from overview.

Rules:
- Only state what the photos or notes show. If the brand, size or material can't be read, use "" and add a
  line to check_before_posting (for example "Check the size tag - not visible in photos"). Never invent
  measurements, model numbers or materials.
- Read every label, tag and handwritten card in the photos (brand, size, materials, measurements, model
  numbers).
- List every visible flaw (stains, pilling, scuffs, holes, missing parts) in overview.flaws and mention them
  honestly in the descriptions.
- overview: title at most 80 characters (brand + item + key details + size). category is a plain path like
  "Women > Tops > Blouses". colors at most 2. style_tags at most 3 short tags.
- eBay: title at most 80 characters, keyword-first (brand, item type, key features, size, color), no
  hype words or punctuation spam. category_path is eBay US's category tree written with " > ".
  condition uses eBay US wording for that category (clothing: "New with tags", "New without tags",
  "New with imperfections", "Pre-owned - Excellent", "Pre-owned - Good", "Pre-owned - Fair";
  other items: "New", "Open box", "Used", "For parts or not working"). item_specifics are eBay's
  usual aspects for that category (Brand, Size, Color, Type, Material, Style, Department, ...),
  only with values you can support.
- Poshmark: title at most 80 characters, readable (brand + item + standout detail). department,
  category and subcategory from Poshmark's own menus (e.g. Women > Tops > Blouses). colors at most 2,
  using Poshmark color names. style_tags at most 3 short tags.
- Vinted (US): title short and plain, about 5 to 8 words. category_path from Vinted's menus with " > "
  (e.g. Women > Clothing > Tops & t-shirts > T-shirts). colors at most 2.
- Descriptions follow the requested style. Cover what it is, condition and flaws, size and fit (say "see
  photos for measurements" unless the photos or notes give them). The eBay description may add detail.
  No emojis. Plain text only, no markdown.
- pricing: give your estimate for a used-market US price from what you see; you have no live sold
  data, so set confidence honestly and say in reasoning what drives the number. The seller's own
  price is what will be used; you are only advising.
- check_before_posting: short, practical to-dos (missing photos of tag or flaws, measurements to add,
  authenticity checks for designer items).`;

export function makeClient(apiKey) {
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 });
}

// photos: [{ dataUrl }] (JPEG data URLs). Returns the parsed listing object.
export async function writeListings({ apiKey, photos, price, notes, style = "friendly" }) {
  if (!apiKey) throw new Error("Add your Claude API key in Settings first.");
  if (!photos.length) throw new Error("Add at least one photo.");
  const client = makeClient(apiKey);

  const imageBlocks = photos.slice(0, MAX_PHOTOS_SENT).map((p) => {
    const [head, data] = p.dataUrl.split(",");
    const media_type = head.slice(5, head.indexOf(";"));
    return { type: "image", source: { type: "base64", media_type, data } };
  });

  let response;
  try {
    response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: { type: "json_schema", schema: LISTING_SCHEMA } },
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            ...imageBlocks,
            {
              type: "text",
              text:
                `Asking price: $${Number(price || 0).toFixed(2)}\n` +
                `Seller notes: ${notes?.trim() || "(none)"}\n` +
                `Description style: ${DESCRIPTION_STYLES[style] || DESCRIPTION_STYLES.friendly}\n\nWrite the listings.`,
            },
          ],
        },
      ],
    });
  } catch (err) {
    throw new Error(explainApiError(err));
  }

  if (response.stop_reason === "refusal") {
    throw new Error("Claude declined to describe this item. Try different photos or add notes.");
  }
  if (response.stop_reason === "max_tokens") {
    throw new Error("The answer was cut off. Please try again.");
  }
  const text = response.content.find((b) => b.type === "text")?.text;
  if (!text) throw new Error("Claude returned no listing. Please try again.");
  return JSON.parse(text);
}

function explainApiError(err) {
  if (err instanceof Anthropic.AuthenticationError) return "Your Claude API key was rejected. Check it in Settings.";
  if (err instanceof Anthropic.PermissionDeniedError) return "This API key isn't allowed to use this model.";
  if (err instanceof Anthropic.RateLimitError) return "Too many requests right now. Wait a minute and try again.";
  if (err instanceof Anthropic.BadRequestError) return `Claude couldn't read the request: ${err.message}`;
  if (err instanceof Anthropic.APIConnectionError) return "Couldn't reach Claude. Check your internet connection.";
  if (err instanceof Anthropic.APIError) return `Claude API error (${err.status ?? "?"}): ${err.message}`;
  return err?.message || String(err);
}

// Copy an AI answer into an item. Overwrites the listing text; keeps price, cost, SKU,
// private notes, labels and listing statuses.
export function applyAi(item, ai) {
  const join = (a) => (Array.isArray(a) ? a.filter(Boolean).join(", ") : a || "");
  const o = ai.overview;
  item.overview = { ...item.overview, title: o.title, description: o.description, condition: o.condition };
  item.details = { category: o.category, brand: o.brand, size: o.size, colors: join(o.colors), style_tags: join(o.style_tags) };
  const keepPrice = (pid) => (item.market?.[pid]?.price ? { price: item.market[pid].price } : {});
  item.market = {
    ebay: {
      ...keepPrice("ebay"),
      title: ai.ebay.title,
      category_path: ai.ebay.category_path,
      condition: ai.ebay.condition,
      item_specifics: (ai.ebay.item_specifics || []).map((s) => `${s.name}: ${s.value}`).join("\n"),
      description: ai.ebay.description,
    },
    poshmark: {
      ...keepPrice("poshmark"),
      title: ai.poshmark.title,
      department: ai.poshmark.department,
      category: ai.poshmark.category,
      subcategory: ai.poshmark.subcategory,
      condition: ai.poshmark.condition,
      colors: join(ai.poshmark.colors),
      style_tags: join(ai.poshmark.style_tags),
    },
    vinted: {
      ...keepPrice("vinted"),
      title: ai.vinted.title,
      category_path: ai.vinted.category_path,
      condition: ai.vinted.condition,
      colors: join(ai.vinted.colors),
      material: o.material,
    },
  };
  item.ai = { pricing: ai.pricing, check_before_posting: ai.check_before_posting || [], flaws: o.flaws || [] };
  return item;
}
