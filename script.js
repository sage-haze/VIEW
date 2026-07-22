const button = document.getElementById("send");
const updateFxButton = document.getElementById("updateFx");

const sectorBox = document.getElementById("sector");
const subsectorBox = document.getElementById("subsector");
const industryBox = document.getElementById("industry");
const timeframeBox = document.getElementById("timeframe");
const fxTenorBox = document.getElementById("fxTenor");
const conversationGoalBox = document.getElementById("conversationGoal");
const relationshipContextBox = document.getElementById("relationshipContext");
const cashPositionBox = document.getElementById("cashPosition");
const purchaseDomesticBox = document.getElementById("purchaseDomestic");
const purchaseInternationalBox = document.getElementById("purchaseInternational");
const salesDomesticBox = document.getElementById("salesDomestic");
const salesInternationalBox = document.getElementById("salesInternational");
const purchaseCountryField = document.getElementById("purchaseCountryField");
const salesCountryField = document.getElementById("salesCountryField");
const purchaseCountrySearch = document.getElementById("purchaseCountrySearch");
const purchaseCountryDropdown = document.getElementById("purchaseCountryDropdown");
const selectedPurchaseCountriesBox = document.getElementById("selectedPurchaseCountries");
const salesCountrySearch = document.getElementById("salesCountrySearch");
const salesCountryDropdown = document.getElementById("salesCountryDropdown");
const selectedSalesCountriesBox = document.getElementById("selectedSalesCountries");

const defaultPromptBox = document.getElementById("defaultPrompt");

const analysisOutput = document.getElementById("analysisOutput");
const bridgePanel = document.getElementById("bridgePanel");
const bridgeOutput = document.getElementById("bridgeOutput");
const sourcesOutput = document.getElementById("sourcesOutput");
const fxOutput = document.getElementById("fxOutput");
const contextOutput = document.getElementById("contextOutput");
const isicDropdown = document.getElementById("isicDropdown");
const selectedIsicBox = document.getElementById("selectedIsic");

let selectedPurchaseCountries = [];
let selectedSalesCountries = [];
let selectedIsic = null;
let suppressIsicDropdownUntil = 0;
const suppressCountryDropdownUntil = { purchase: 0, sales: 0 };
let fxCharts = {};
let signalRequestInFlight = false;
let signalRunLocked = false;

function updateGenerateSignalsButtonState() {
  if (!button) return;
  button.disabled = signalRequestInFlight || signalRunLocked;
  if (signalRequestInFlight) {
    button.title = "";
  } else if (signalRunLocked) {
    button.title = "Update the setup above to generate a fresh set of signals.";
  } else {
    button.title = "";
  }
}

function unlockGenerateSignalsForSetupChange() {
  if (!signalRunLocked) return;
  signalRunLocked = false;
  updateGenerateSignalsButtonState();
}

function isSetupChangingTarget(target) {
  if (!target || typeof target.closest !== "function") return false;
  if (!target.closest(".preparation-main")) return false;
  if (target.closest("#send")) return false;
  if (target.id === "purchaseCountrySearch" || target.id === "salesCountrySearch") return false;
  return Boolean(target.matches?.("input, select, textarea") || target.closest(".country-chip button"));
}

const BUSINESS_RELEVANCE_TERMS = [
  "agriculture", "crop", "growing", "farming", "forestry", "fishing", "aquaculture",
  "mining", "quarrying", "extraction",
  "manufacture", "manufacturing", "processing", "production", "factory",
  "wholesale", "retail", "trade", "trading", "distribution", "export", "import",
  "transport", "storage", "logistics", "warehousing",
  "construction", "installation", "repair", "maintenance",
  "food", "beverage", "textile", "chemical", "metal", "machinery", "equipment",
  "financial", "insurance", "professional", "technical", "information", "communication"
];

const SERVICE_CONTEXT_TERMS = [
  "education", "school", "student", "students", "academic", "tutoring", "training",
  "accommodation", "hotel", "restaurant", "tourism", "travel",
  "health", "hospital", "medical", "social", "welfare",
  "religious", "membership", "association", "public", "government", "administration",
  "personal", "beauty", "wellness", "recreation", "entertainment", "sport"
];

const COMMERCIAL_FALLBACK_SECTORS = [
  "agriculture, forestry and fishing",
  "mining and quarrying",
  "manufacturing",
  "wholesale and retail trade; repair of motor vehicles and motorcycles",
  "transportation and storage",
  "construction"
];

const LOW_CONFIDENCE_MAX_RESULTS = 6;
const FALLBACK_SUGGESTION_MAX_RESULTS = 8;

const GENERIC_QUERY_TERMS = new Set([
  "business", "company", "industry", "activity", "activities", "service", "services",
  "product", "products", "goods", "general", "other", "misc", "miscellaneous"
]);

const ROLE_FAMILIES = [
  {
    id: "agriculture",
    label: "Agriculture / farming",
    terms: ["farm", "farming", "farmer", "grower", "plantation", "crop", "livestock", "animal production", "forestry", "logging", "fishing", "aquaculture"],
    anchors: ["agriculture", "crop", "animal production", "hunting", "forestry", "logging", "fishing", "aquaculture", "growing", "farming"]
  },
  {
    id: "extraction",
    label: "Mining / extraction",
    terms: ["mine", "mining", "miner", "quarry", "quarrying", "extraction", "extract", "oil field", "gas field"],
    anchors: ["mining", "quarrying", "extraction", "coal", "lignite", "petroleum", "natural gas", "metal ores", "support service"]
  },
  {
    id: "manufacturing",
    label: "Manufacturing / processing",
    terms: ["manufacture", "manufacturer", "manufacturing", "factory", "producer", "production", "processing", "process", "maker", "assembly", "assembler", "fabrication", "fabricate", "plant"],
    anchors: ["manufacture", "manufacturing", "processing", "production", "fabricated", "assembly", "repair and installation"]
  },
  {
    id: "utilities",
    label: "Utilities / environmental services",
    terms: ["utility", "utilities", "power", "electricity", "gas", "steam", "water supply", "waste", "sewerage", "recycling", "remediation", "renewable"],
    anchors: ["electricity", "gas", "steam", "air conditioning", "water", "sewerage", "waste", "materials recovery", "remediation"]
  },
  {
    id: "construction_real_estate",
    label: "Construction / real estate",
    terms: ["construction", "contractor", "building", "civil engineering", "developer", "development", "property", "real estate", "condominium", "apartment", "housing", "office building", "shopping center", "factory construction"],
    anchors: ["construction", "building", "civil engineering", "specialized construction", "real estate", "development", "residential", "condominium", "apartment", "commercial building", "leased property"]
  },
  {
    id: "trade",
    label: "Wholesale / retail trade",
    terms: ["wholesale", "wholesaler", "retail", "retailer", "shop", "store", "dealer", "trader", "trading", "distributor", "distribution", "importer", "exporter", "supplier"],
    anchors: ["wholesale", "retail", "trade", "repair of motor vehicles", "dealer", "distribution"]
  },
  {
    id: "transport_storage",
    label: "Transport / logistics",
    terms: ["transport", "transportation", "logistics", "freight", "shipping", "cargo", "courier", "postal", "warehouse", "warehousing", "storage", "forwarder", "fleet", "air transport", "water transport", "land transport"],
    anchors: ["transport", "transportation", "storage", "warehousing", "support activities for transportation", "postal", "courier", "cargo", "pipelines", "air transport", "water transport", "land transport"]
  },
  {
    id: "hospitality_food_service",
    label: "Hospitality / food service",
    terms: ["hotel", "resort", "accommodation", "restaurant", "cafe", "catering", "food service", "hospitality", "tourism", "travel"],
    anchors: ["accommodation", "food and beverage service", "hotel", "restaurant", "catering", "travel agency", "tour operator", "reservation service"]
  },
  {
    id: "information_communication",
    label: "Information / communication",
    terms: ["software", "it", "technology", "telecom", "telecommunications", "data centre", "data center", "cloud", "hosting", "programming", "broadcasting", "publishing", "media", "film", "video"],
    anchors: ["information", "communication", "publishing", "motion picture", "television", "broadcasting", "telecommunications", "computer programming", "consultancy", "information service", "data processing", "hosting"]
  },
  {
    id: "financial_insurance",
    label: "Financial / insurance",
    terms: ["bank", "banking", "finance", "financial", "insurance", "insurer", "reinsurance", "pension", "securities", "broker", "asset management", "fund", "leasing", "factoring", "money transfer", "exchange"],
    anchors: ["financial", "insurance", "bank", "credit", "cooperative", "factoring", "swaps", "hedging", "securities", "broker", "asset management", "fund", "money transfer", "bureaux de change"]
  },
  {
    id: "professional_technical",
    label: "Professional / technical services",
    terms: ["legal", "law", "accounting", "audit", "consulting", "consultancy", "head office", "management", "engineering", "architectural", "testing", "research", "advertising", "market research", "veterinary"],
    anchors: ["professional", "scientific", "technical", "legal", "accounting", "head offices", "management consultancy", "architectural", "engineering", "technical testing", "research and development", "advertising", "market research", "veterinary"]
  },
  {
    id: "administrative_support",
    label: "Administrative / support services",
    terms: ["rental", "leasing", "employment", "staffing", "security", "investigation", "cleaning", "landscape", "office support", "business support", "facility", "facilities"],
    anchors: ["administrative", "support service", "rental", "leasing", "employment", "security", "investigation", "services to buildings", "landscape", "office administrative", "office support", "business support"]
  },
  {
    id: "public_education_health",
    label: "Public / education / health",
    terms: ["government", "public administration", "defence", "defense", "social security", "school", "education", "university", "training", "hospital", "clinic", "health", "medical", "care", "social work"],
    anchors: ["public administration", "defence", "social security", "education", "human health", "hospital", "medical", "residential care", "social work"]
  },
  {
    id: "arts_other_services",
    label: "Arts / recreation / other services",
    terms: ["art", "arts", "entertainment", "creative", "museum", "library", "archive", "sports", "recreation", "amusement", "gambling", "membership", "association", "personal service", "repair computers", "household goods", "domestic personnel", "embassy", "international organization"],
    anchors: ["arts", "entertainment", "recreation", "creative", "library", "archives", "museums", "gambling", "sports", "amusement", "membership", "personal service", "repair of computers", "household goods", "households", "extraterritorial"]
  }
];

const DOMAIN_FAMILIES = [
  {
    id: "fish_seafood",
    label: "Fishery / seafood",
    terms: ["seafood", "fish", "fishery", "fishing", "aquaculture", "crustacean", "crustaceans", "mollusc", "molluscs", "shrimp", "prawn"],
    anchors: ["fish", "fishing", "fishery", "aquaculture", "crustaceans", "molluscs", "shrimp", "prawn"]
  },
  {
    id: "agri_food",
    label: "Agriculture / food",
    terms: ["food", "beverage", "agriculture", "crop", "livestock", "forestry", "fishing", "aquaculture", "seafood", "meat", "dairy", "rice", "grain", "sugar", "fruit", "vegetable", "coffee", "feed", "tobacco"],
    anchors: ["food", "beverage", "tobacco", "agriculture", "crop", "animal", "forestry", "fishing", "aquaculture", "meat", "fish", "fruit", "vegetable", "dairy", "grain", "rice", "sugar", "coffee", "feed"]
  },
  {
    id: "textile_apparel",
    label: "Textiles / apparel / leather",
    terms: ["textile", "fabric", "garment", "apparel", "clothing", "fashion", "footwear", "leather", "yarn", "cotton"],
    anchors: ["textile", "wearing apparel", "apparel", "leather", "footwear", "fabric", "yarn", "clothing"]
  },
  {
    id: "wood_paper_printing",
    label: "Wood / paper / printing",
    terms: ["wood", "timber", "furniture wood", "cork", "paper", "pulp", "packaging paper", "print", "printer", "printing", "publisher", "publishing", "recorded media"],
    anchors: ["wood", "cork", "straw", "plaiting", "paper", "print", "printing", "publishing", "recorded media"]
  },
  {
    id: "chemicals_energy_materials",
    label: "Chemicals / energy / materials",
    terms: ["chemical", "chemicals", "pharmaceutical", "pharma", "rubber", "plastic", "resin", "fertilizer", "paint", "petroleum", "oil", "gas", "fuel", "coke", "cement", "ceramic", "glass", "non metallic mineral", "metal", "steel", "aluminium", "aluminum"],
    anchors: ["chemical", "pharmaceutical", "rubber", "plastics", "coke", "refined petroleum", "petroleum", "natural gas", "non metallic mineral", "cement", "ceramic", "glass", "basic metals", "fabricated metal", "steel", "metal"]
  },
  {
    id: "metals_minerals_jewellery",
    label: "Metals / minerals / jewellery",
    terms: [
      "metal", "metals", "metal ore", "metal ores", "ore", "ores", "mineral", "minerals",
      "precious metal", "precious metals", "non ferrous", "ferrous", "base metal", "base metals",
      "gold", "silver", "platinum", "palladium", "copper", "zinc", "tin", "nickel", "aluminium", "aluminum", "steel", "iron",
      "gem", "gems", "gemstone", "gemstones", "precious stone", "precious stones", "diamond", "diamonds", "ruby", "sapphire", "emerald",
      "jewellery", "jewelry", "goldsmith", "goldsmiths", "bijouterie", "watch", "watches"
    ],
    anchors: [
      "metal ores", "non-ferrous metal ores", "ferrous", "non-ferrous", "basic precious metals", "basic metals", "fabricated metal",
      "precious", "semi-precious", "stones", "jewellery", "goldsmiths", "bijouterie", "diamonds", "metal in primary forms", "ores and metals"
    ]
  },
  {
    id: "automotive_transport_equipment",
    label: "Automotive / transport equipment",
    terms: ["auto", "automotive", "vehicle", "motor vehicle", "motorcycle", "trailer", "auto parts", "vehicle parts", "motor vehicle parts", "transport equipment"],
    anchors: ["motor vehicle", "motorcycle", "trailer", "transport equipment"]
  },
  {
    id: "machinery_electronics",
    label: "Machinery / electronics",
    terms: ["machinery", "machine", "equipment", "electronics", "electrical", "computer", "optical", "semiconductor", "component", "electronic parts", "electrical parts"],
    anchors: ["machinery", "equipment", "electronic", "electrical", "computer", "optical", "component"]
  },
  {
    id: "construction_property",
    label: "Construction / property",
    terms: ["construction", "building", "civil engineering", "infrastructure", "contractor", "property", "real estate", "housing", "residential", "condominium", "apartment", "office building", "shopping center", "commercial building", "land development", "factory"],
    anchors: ["construction", "building", "civil engineering", "real estate", "development", "housing", "residential", "condominium", "apartment", "commercial building", "office building", "shopping center", "land development", "factory"]
  },
  {
    id: "utilities_environment",
    label: "Utilities / waste / environment",
    terms: ["electricity", "power", "gas", "steam", "air conditioning", "water", "sewerage", "waste", "recycling", "materials recovery", "remediation", "environment"],
    anchors: ["electricity", "gas", "steam", "air conditioning", "water", "sewerage", "waste", "materials recovery", "remediation"]
  },
  {
    id: "trade_repair",
    label: "Trade / repair",
    terms: ["wholesale", "retail", "trade", "dealer", "distributor", "import", "export", "motor vehicle repair", "motorcycle repair", "repair"],
    anchors: ["wholesale", "retail", "trade", "repair", "motor vehicles", "motorcycles", "dealer"]
  },
  {
    id: "transport_logistics",
    label: "Transport / logistics",
    terms: ["transport", "logistics", "warehouse", "warehousing", "storage", "postal", "courier", "freight", "cargo", "shipping", "pipeline", "air transport", "water transport", "land transport"],
    anchors: ["transport", "storage", "warehousing", "postal", "courier", "freight", "cargo", "pipeline", "air transport", "water transport", "land transport"]
  },
  {
    id: "hospitality_tourism_foodservice",
    label: "Accommodation / food service / tourism",
    terms: ["accommodation", "hotel", "resort", "restaurant", "food service", "cafe", "catering", "tourism", "travel", "tour operator", "reservation"],
    anchors: ["accommodation", "hotel", "resort", "food and beverage service", "restaurant", "catering", "travel agency", "tour operator", "reservation"]
  },
  {
    id: "digital_media_telecom",
    label: "Digital / media / telecom",
    terms: ["publishing", "media", "film", "video", "television", "music", "broadcasting", "telecom", "telecommunications", "software", "computer programming", "it consulting", "information service", "data", "hosting", "cloud"],
    anchors: ["publishing", "motion picture", "video", "television", "music", "broadcasting", "telecommunications", "computer programming", "consultancy", "information service", "data", "hosting"]
  },
  {
    id: "financial_insurance",
    label: "Financial / insurance",
    terms: ["financial", "finance", "bank", "banking", "commercial bank", "cooperative", "credit", "factoring", "hedging", "securities", "broker", "underwriter", "money transfer", "bureaux de change", "asset management", "fund", "insurance", "reinsurance", "pension"],
    anchors: ["financial", "bank", "cooperative", "credit", "factoring", "hedging", "securities", "broker", "underwriter", "money transfer", "bureaux de change", "asset management", "fund", "insurance", "reinsurance", "pension"]
  },
  {
    id: "professional_business_support",
    label: "Professional / business support",
    terms: ["legal", "accounting", "head office", "management consultancy", "architecture", "engineering", "technical testing", "research", "advertising", "market research", "veterinary", "rental", "leasing", "employment", "security", "cleaning", "landscape", "office support", "business support"],
    anchors: ["legal", "accounting", "head offices", "management consultancy", "architectural", "engineering", "technical testing", "research and development", "advertising", "market research", "veterinary", "rental", "leasing", "employment", "security", "investigation", "services to buildings", "landscape", "office administrative", "business support"]
  },
  {
    id: "public_education_health_social",
    label: "Public / education / health / social",
    terms: ["public administration", "government", "defence", "defense", "social security", "education", "school", "university", "training", "health", "healthcare", "hospital", "clinic", "medical", "residential care", "social work", "welfare"],
    anchors: ["public administration", "defence", "social security", "education", "human health", "health", "hospital", "medical", "residential care", "social work"]
  },
  {
    id: "arts_recreation_other",
    label: "Arts / recreation / other services",
    terms: ["creative", "arts", "entertainment", "library", "archive", "museum", "cultural", "gambling", "betting", "sports", "amusement", "recreation", "membership", "association", "personal service", "household", "domestic personnel", "international organization", "extraterritorial"],
    anchors: ["creative", "arts", "entertainment", "libraries", "archives", "museums", "cultural", "gambling", "betting", "sports", "amusement", "recreation", "membership", "personal service", "household", "domestic", "extraterritorial"]
  }
];

function normaliseSearchText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueWords(value) {
  const words = normaliseSearchText(value).split(" ").filter(word => word.length > 1);
  const expanded = [];

  function addToken(token) {
    const cleaned = normaliseSearchText(token);
    if (cleaned && cleaned.length > 1) expanded.push(cleaned);
  }

  words.forEach(word => {
    addToken(word);

    // Conservative morphology helps business-language search without hardcoding
    // individual examples. It lets terms such as printer/printing/printed,
    // exporter/exporting/exported, and manufacturers/manufacturing share a
    // stable root, while avoiding very short stems that cause noisy matches.
    if (word.length > 4 && word.endsWith("ies")) addToken(`${word.slice(0, -3)}y`);
    else if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) addToken(word.slice(0, -1));

    if (word.length > 6 && word.endsWith("ing")) addToken(word.slice(0, -3));
    if (word.length > 5 && word.endsWith("ed")) addToken(word.slice(0, -2));
    if (word.length > 6 && word.endsWith("er")) addToken(word.slice(0, -2));
    if (word.length > 6 && word.endsWith("or")) addToken(word.slice(0, -2));
  });

  return [...new Set(expanded)];
}

function bigrams(value) {
  const text = normaliseSearchText(value).replace(/\s+/g, " ");
  if (text.length < 2) return text ? [text] : [];
  const grams = [];
  for (let i = 0; i < text.length - 1; i += 1) grams.push(text.slice(i, i + 2));
  return grams;
}

function diceCoefficient(a, b) {
  const aGrams = bigrams(a);
  const bGrams = bigrams(b);
  if (!aGrams.length || !bGrams.length) return 0;

  const counts = new Map();
  aGrams.forEach(gram => counts.set(gram, (counts.get(gram) || 0) + 1));

  let overlap = 0;
  bGrams.forEach(gram => {
    const count = counts.get(gram) || 0;
    if (count > 0) {
      overlap += 1;
      counts.set(gram, count - 1);
    }
  });

  return (2 * overlap) / (aGrams.length + bGrams.length);
}

function wordSimilarity(term, word) {
  if (!term || !word) return 0;
  if (word === term) return 1;
  if (word.startsWith(term) || term.startsWith(word)) return 0.88;
  if (word.includes(term) || term.includes(word)) return 0.72;
  if (term.length < 5 || word.length < 5) return 0;
  if (Math.abs(term.length - word.length) > 4) return 0;
  if (term[0] !== word[0]) return 0;
  return diceCoefficient(term, word);
}

function hasAnyWord(text, words) {
  const haystack = ` ${normaliseSearchText(text)} `;
  return words.some(word => haystack.includes(` ${normaliseSearchText(word)} `));
}


function getPreparedIsicEntry(entry) {
  if (!entry) return { entryText: "", fullEntryText: "", entryWords: [] };
  if (!entry.__searchIndex) {
    const entryText = normaliseSearchText(`${entry.code} ${entry.description}`);
    const fullEntryText = normaliseSearchText(`${entry.code} ${entry.description} ${entry.sector || ""} ${entry.subsector || ""}`);
    const detailText = normaliseSearchText(`${entry.description || ""} ${entry.subsector || ""}`);
    entry.__searchIndex = {
      entryText,
      fullEntryText,
      entryWords: uniqueWords(fullEntryText),
      detailText,
      detailWords: uniqueWords(detailText),
      businessRelevance: null
    };
  }
  return entry.__searchIndex;
}

function getBusinessRelevance(entry) {
  const prepared = getPreparedIsicEntry(entry);
  if (prepared.businessRelevance !== null) return prepared.businessRelevance;

  let relevance = 0;
  BUSINESS_RELEVANCE_TERMS.forEach(term => {
    if (prepared.entryWords.includes(term)) relevance += 1;
  });

  const sectorText = normaliseSearchText(entry.sector || "");
  if (COMMERCIAL_FALLBACK_SECTORS.includes(sectorText)) relevance += 2;

  prepared.businessRelevance = Math.min(relevance, 6);
  return prepared.businessRelevance;
}

function getServiceContextPenalty(entry, queryWords) {
  const combined = `${entry.sector || ""} ${entry.subsector || ""} ${entry.description || ""}`;
  const entryLooksServiceHeavy = hasAnyWord(combined, SERVICE_CONTEXT_TERMS);
  if (!entryLooksServiceHeavy) return 0;

  const queryClearlyServiceRelated = queryWords.some(term =>
    SERVICE_CONTEXT_TERMS.some(serviceTerm => wordSimilarity(term, serviceTerm) >= 0.9)
  );

  // Do not punish service-sector matches when the user clearly searched for that context.
  if (queryClearlyServiceRelated) return 0;

  return 45;
}

function phraseOrWordMatches(term, queryText, queryWords, threshold = 0.88) {
  const cleaned = normaliseSearchText(term);
  if (!cleaned) return false;
  if (cleaned.includes(" ")) return queryText.includes(cleaned);
  if (queryWords.includes(cleaned)) return true;
  // Keep family detection deliberately conservative. Fuzzy matching still exists in the
  // normal ISIC text score, but role/domain families should not fire from weak overlap.
  return queryWords.some(word => word.length >= 5 && cleaned.length >= 5 && wordSimilarity(word, cleaned) >= threshold);
}

function getFamilyMatch(family, queryText, queryWords) {
  const matchedTerms = family.terms.filter(term => phraseOrWordMatches(term, queryText, queryWords));
  return {
    matched: matchedTerms.length > 0,
    terms: matchedTerms
  };
}


function queryHasDomainSignal(queryText, queryWords) {
  return DOMAIN_FAMILIES.some(family => getFamilyMatch(family, queryText, queryWords).matched);
}

function countAnchorHits(family, entryText, entryWords) {
  const hits = [];
  family.anchors.forEach(anchor => {
    const cleaned = normaliseSearchText(anchor);
    if (!cleaned) return;
    let matched = cleaned.includes(" ")
      ? entryText.includes(cleaned)
      : entryWords.includes(cleaned);
    if (matched && (entryText.includes(`except of ${cleaned}`) || entryText.includes(`except ${cleaned}`))) {
      matched = false;
    }
    if (matched) hits.push(anchor);
  });
  return [...new Set(hits)];
}

function getRoleDomainScores(entry, queryText, queryWords, preparedEntry = null) {
  if (!queryWords.length) {
    return { roleScore: 0, domainScore: 0, signalScore: 0, matchedRoles: [], matchedDomains: [] };
  }

  const prepared = preparedEntry || getPreparedIsicEntry(entry);
  const entryText = prepared.detailText || prepared.fullEntryText;
  const entryWords = prepared.detailWords || prepared.entryWords;
  let roleScore = 0;
  let domainScore = 0;
  const matchedRoles = [];
  const matchedDomains = [];

  ROLE_FAMILIES.forEach(family => {
    const queryMatch = getFamilyMatch(family, queryText, queryWords);
    if (!queryMatch.matched) return;
    const anchorHits = countAnchorHits(family, entryText, entryWords);
    if (!anchorHits.length) return;

    roleScore += Math.min(95, 38 + anchorHits.length * 14 + queryMatch.terms.length * 8);
    matchedRoles.push(family.label);
  });

  DOMAIN_FAMILIES.forEach(family => {
    const queryMatch = getFamilyMatch(family, queryText, queryWords);
    if (!queryMatch.matched) return;
    const anchorHits = countAnchorHits(family, entryText, entryWords);
    if (!anchorHits.length) return;

    const exactQueryAnchorHits = queryMatch.terms.filter(term => {
      const cleaned = normaliseSearchText(term);
      return cleaned && entryText.includes(cleaned);
    }).length;
    domainScore += Math.min(130, 45 + anchorHits.length * 12 + queryMatch.terms.length * 8 + exactQueryAnchorHits * 45);
    matchedDomains.push(family.label);
  });

  return {
    roleScore,
    domainScore,
    signalScore: roleScore + domainScore,
    matchedRoles: [...new Set(matchedRoles)],
    matchedDomains: [...new Set(matchedDomains)]
  };
}

function getConceptScore(entry, queryWords, queryText = "") {
  // Backward-compatible wrapper: conceptScore now means general business role/object signal,
  // not a small hand-tuned keyword list. This keeps matching inclusive across the available
  // sector/subsector taxonomy while avoiding overfitting to a few stress-test words.
  return getRoleDomainScores(entry, queryText || queryWords.join(" "), queryWords).signalScore;
}

function diversifyCommercialFallback(scored) {
  const picks = [];
  const usedSectors = new Set();
  const usedCodes = new Set();

  COMMERCIAL_FALLBACK_SECTORS.forEach(sectorName => {
    const match = scored.find(entry =>
      !usedCodes.has(entry.code) &&
      normaliseSearchText(entry.sector || "") === sectorName &&
      entry.businessScore >= 18 &&
      entry.penaltyScore === 0
    );
    if (match) {
      picks.push(match);
      usedCodes.add(match.code);
      usedSectors.add(normaliseSearchText(match.sector || ""));
    }
  });

  scored.forEach(entry => {
    if (picks.length >= LOW_CONFIDENCE_MAX_RESULTS) return;
    if (usedCodes.has(entry.code) || entry.businessScore < 18 || entry.penaltyScore > 0) return;
    picks.push(entry);
    usedCodes.add(entry.code);
  });

  return picks.slice(0, LOW_CONFIDENCE_MAX_RESULTS);
}


function queryMatchesRole(roleId, queryText, queryWords) {
  const family = ROLE_FAMILIES.find(item => item.id === roleId);
  return family ? getFamilyMatch(family, queryText, queryWords).matched : false;
}

function descriptionHasAny(entry, terms) {
  const text = normaliseSearchText(entry?.description || "");
  return terms.some(term => {
    const cleaned = normaliseSearchText(term);
    return cleaned.includes(" ") ? text.includes(cleaned) : uniqueWords(text).includes(cleaned);
  });
}

function scoreIsicMatch(entry, query) {
  const q = normaliseSearchText(query);
  const prepared = getPreparedIsicEntry(entry);
  const entryText = prepared.entryText;
  const fullEntryText = prepared.fullEntryText;
  const entryWords = prepared.entryWords;

  const sector = sectorBox?.value || "";
  const subsector = subsectorBox?.value || "";
  const contextText = normaliseSearchText(`${sector} ${subsector}`);
  const contextWords = uniqueWords(contextText);
  const queryWords = uniqueWords(q).filter(term => term.length > 2);

  let score = 0;
  let queryScore = 0;
  let contextScore = 0;
  let businessScore = getBusinessRelevance(entry) * 6;
  let conceptScore = 0;
  let roleScore = 0;
  let domainScore = 0;
  let matchedRoles = [];
  let matchedDomains = [];
  let penaltyScore = 0;

  // Sector/subsector helps ranking, but should not fully determine the answer.
  contextWords.forEach(term => {
    const best = Math.max(0, ...entryWords.map(word => wordSimilarity(term, word)));
    if (best >= 0.9) contextScore += best * 16;
    else if (best >= 0.8) contextScore += best * 8;
  });

  if (!q) {
    score = contextScore + businessScore;
    return { score, queryScore: 0, conceptScore: 0, roleScore: 0, domainScore: 0, contextScore, businessScore, penaltyScore, matchedRoles: [], matchedDomains: [] };
  }

  if (entryText === q) queryScore += 1000;
  if (entry.code && normaliseSearchText(entry.code) === q) queryScore += 900;
  if (entryText.includes(q)) queryScore += 450 + q.length;
  else if (fullEntryText.includes(q)) queryScore += 280 + q.length;

  queryWords.forEach(term => {
    const best = Math.max(0, ...entryWords.map(word => wordSimilarity(term, word)));

    // Fuzzy matching should catch typos and related wording, but weak text overlap
    // should not be enough to push unrelated institutional categories to the top.
    if (best >= 0.97) queryScore += 140;
    else if (best >= 0.91) queryScore += 90;
    else if (term.length >= 7 && best >= 0.86) queryScore += 35;
  });

  const phraseSimilarity = diceCoefficient(q, fullEntryText);
  if (phraseSimilarity >= 0.48) queryScore += phraseSimilarity * 70;

  const roleDomain = getRoleDomainScores(entry, q, queryWords, prepared);
  roleScore = roleDomain.roleScore;
  domainScore = roleDomain.domainScore;
  conceptScore = roleDomain.signalScore;
  matchedRoles = roleDomain.matchedRoles;
  matchedDomains = roleDomain.matchedDomains;
  penaltyScore = getServiceContextPenalty(entry, queryWords);

  // If the query clearly contains an object/domain signal, avoid elevating entries
  // that only match a generic role word such as manufacture, distributor or operator.
  if (queryHasDomainSignal(q, queryWords) && domainScore === 0 && queryWords.length > 1) {
    penaltyScore += 85;
  }

  if (queryMatchesRole("trade", q, queryWords)) {
    const descriptionLooksTrade = descriptionHasAny(entry, ["wholesale", "retail", "trade", "dealer", "distribution"]);
    const descriptionLooksRepair = descriptionHasAny(entry, ["maintenance", "repair"]);
    if (!descriptionLooksTrade && descriptionLooksRepair) penaltyScore += 70;
  }

  if (queryMatchesRole("manufacturing", q, queryWords)) {
    const descriptionLooksManufacturing = descriptionHasAny(entry, ["manufacture", "manufacturing", "processing", "production", "assembly"]);
    const descriptionLooksNonManufacturing = descriptionHasAny(entry, ["wholesale", "retail", "maintenance", "repair", "rental", "leasing"]);
    if (!descriptionLooksManufacturing && descriptionLooksNonManufacturing) penaltyScore += 55;
  }

  // Business relevance is a tie-breaker and safety signal, not a hardcoded synonym map.
  // It helps broad product/service descriptions favour commercial activities over generic
  // education, accommodation, membership, or public-service categories when confidence is low.
  score = queryScore + conceptScore + contextScore + businessScore - penaltyScore;

  return { score, queryScore, conceptScore, roleScore, domainScore, contextScore, businessScore, penaltyScore, matchedRoles, matchedDomains };
}


function getLowConfidenceTypedSuggestions(q, scored) {
  const queryText = normaliseSearchText(q || "");
  const queryWords = uniqueWords(queryText).filter(term => term.length > 2 && !GENERIC_QUERY_TERMS.has(term));
  if (!queryText || !queryWords.length) return [];

  return scored
    .map(entry => {
      const prepared = getPreparedIsicEntry(entry);
      const entryWords = prepared.entryWords || [];
      const fullEntryText = prepared.fullEntryText || prepared.entryText || "";
      let lowConfidenceTextScore = 0;

      if (fullEntryText.includes(queryText)) lowConfidenceTextScore += 95;

      queryWords.forEach(term => {
        const best = Math.max(0, ...entryWords.map(word => wordSimilarity(term, word)));
        if (entryWords.includes(term)) lowConfidenceTextScore += 70;
        else if (entryWords.some(word => word.startsWith(term) || term.startsWith(word))) lowConfidenceTextScore += 45;
        else if (term.length >= 5 && best >= 0.82) lowConfidenceTextScore += 34;
        else if (term.length >= 5 && best >= 0.74) lowConfidenceTextScore += 18;
      });

      const phraseSimilarity = diceCoefficient(queryText, fullEntryText);
      if (phraseSimilarity >= 0.18) lowConfidenceTextScore += phraseSimilarity * 40;

      return {
        ...entry,
        lowConfidenceTextScore,
        fallbackRankScore: lowConfidenceTextScore + (entry.queryScore || 0) + (entry.conceptScore || 0) * 0.55 + (entry.contextScore || 0) * 0.35 + (entry.businessScore || 0) * 0.15 - (entry.penaltyScore || 0) * 0.7
      };
    })
    .filter(entry => entry.lowConfidenceTextScore >= 18 && (entry.penaltyScore || 0) < 110)
    .sort((a, b) => b.fallbackRankScore - a.fallbackRankScore || a.description.localeCompare(b.description))
    .slice(0, FALLBACK_SUGGESTION_MAX_RESULTS);
}

function getBroadStartingPointSuggestions(scored) {
  const sectorOrder = typeof SECTOR_DATA !== "undefined" ? Object.keys(SECTOR_DATA) : [];
  const representatives = [];
  const usedCodes = new Set();

  sectorOrder.forEach(sectorName => {
    const representative = scored.find(entry =>
      !usedCodes.has(entry.code) &&
      normaliseSearchText(entry.sector || "") === normaliseSearchText(sectorName) &&
      (entry.businessScore || 0) >= 12 &&
      (entry.penaltyScore || 0) < 90
    ) || scored.find(entry =>
      !usedCodes.has(entry.code) &&
      normaliseSearchText(entry.sector || "") === normaliseSearchText(sectorName)
    );

    if (representative) {
      representatives.push(representative);
      usedCodes.add(representative.code);
    }
  });

  return representatives.length ? representatives : scored;
}

function getContextFallbackSuggestions(scored) {
  const selectedSector = normaliseSearchText(sectorBox?.value || "");
  const selectedSubsector = normaliseSearchText(subsectorBox?.value || "");

  if (selectedSubsector) {
    const inSubsector = scored.filter(entry => normaliseSearchText(entry.subsector || "") === selectedSubsector);
    if (inSubsector.length) return { entries: inSubsector, reason: "Suggested from selected subsector" };
  }

  if (selectedSector) {
    const inSector = scored.filter(entry => normaliseSearchText(entry.sector || "") === selectedSector);
    if (inSector.length) return { entries: inSector, reason: "Suggested from selected sector" };
  }

  return { entries: [], reason: "" };
}

function getFallbackIsicSuggestions(q, scored) {
  const hasQuery = Boolean(normaliseSearchText(q || ""));

  function mark(entries, reason) {
    const seen = new Set();
    return entries
      .filter(entry => entry && entry.code && !seen.has(entry.code) && seen.add(entry.code))
      .slice(0, FALLBACK_SUGGESTION_MAX_RESULTS)
      .map(entry => ({
        ...entry,
        fallbackSuggestion: true,
        fallbackReason: reason
      }));
  }

  // Blank input is different from a failed search: with no typed signal, help the
  // banker choose from the selected sector/subsector first, then show broad starts.
  if (!hasQuery) {
    const contextFallback = getContextFallbackSuggestions(scored);
    if (contextFallback.entries.length) return mark(contextFallback.entries, contextFallback.reason);
    return mark(getBroadStartingPointSuggestions(scored), "Suggested starting points");
  }

  // Typed input should remain query-aware even when confidence is low. Show the
  // nearest lexical suggestions before falling back to sector representatives.
  const weakTextMatches = getLowConfidenceTypedSuggestions(q, scored);
  if (weakTextMatches.length) return mark(weakTextMatches, "No close match — nearest text suggestions");

  // If the typed words suggest a broad role/domain, use that next. This keeps
  // inputs such as “electronics distributor” or “hotel operator” helpful even
  // when no exact ISIC wording exists.
  const weakSignalMatches = scored.filter(entry =>
    (entry.roleScore > 0 || entry.domainScore > 0 || entry.conceptScore > 0) &&
    (entry.penaltyScore || 0) < 90
  );
  if (weakSignalMatches.length) return mark(weakSignalMatches, "No close match — related role/domain suggestions");

  // Only after using the typed signal should selected sector/subsector drive the
  // fallback. This avoids typed failed searches looking identical to blank input.
  const contextFallback = getContextFallbackSuggestions(scored);
  if (contextFallback.entries.length) return mark(contextFallback.entries, contextFallback.reason);

  // Final fallback: if the typed text gives no usable signal and no sector context
  // exists, do not show random cross-sector representatives. Keeping the dropdown
  // closed is less misleading than offering unrelated activities just because the
  // field is compulsory; validation will still require a proper ISIC selection.
  return [];
}

function getIsicMatches(query) {
  const q = normaliseSearchText(query);
  const selectedSector = normaliseSearchText(sectorBox?.value || "");
  const hasSelectedSector = Boolean(selectedSector);

  const scored = ISIC_DATA
    .map(entry => ({ ...entry, ...scoreIsicMatch(entry, q) }))
    .sort((a, b) => b.score - a.score || a.description.localeCompare(b.description));

  // Do not open a dropdown before the banker has typed anything. Industry is
  // compulsory, but blank-input suggestions felt random and distracted from the
  // client setup flow. Validation still prevents submission without selection.
  if (!q) return [];

  const queryWords = uniqueWords(q).filter(term => term.length > 2 && !GENERIC_QUERY_TERMS.has(term));

  // Strong lexical/code matches remain the most reliable and are shown first.
  const strongMatches = scored
    .filter(entry => entry.queryScore >= 90 && entry.score >= 70)
    .slice(0, 10);
  if (strongMatches.length >= 4) return strongMatches;

  // Medium matches must have evidence from the user's typed words. Commercial relevance
  // may boost ranking, but it should never be enough by itself to create suggestions.
  const acceptableMatches = scored
    .filter(entry => {
      const sectorFit = hasSelectedSector && normaliseSearchText(entry.sector || "") === selectedSector;
      const hasTypedEvidence = entry.queryScore >= 35 || entry.conceptScore >= 45;
      const hasMinimumConfidence = entry.score >= 55;
      return hasMinimumConfidence && hasTypedEvidence && (entry.penaltyScore === 0 || entry.queryScore >= 90 || sectorFit);
    })
    .slice(0, 8);
  if (acceptableMatches.length > 0) return acceptableMatches;

  // If the user selected a sector, use it as a fallback. Without a sector, avoid
  // returning random fuzzy guesses for unfamiliar words.
  const contextMatches = scored
    .filter(entry => entry.contextScore > 0 && entry.score >= 20)
    .slice(0, 8);
  if (contextMatches.length > 0) return contextMatches;

  // Last resort: only show very close word matches. Otherwise show no dropdown so the
  // user can keep their free-text industry description without being misled.
  const closeWordMatches = scored
    .filter(entry => entry.queryScore >= 70 && entry.score >= 70)
    .slice(0, LOW_CONFIDENCE_MAX_RESULTS);

  if (closeWordMatches.length > 0) return closeWordMatches;

  return getFallbackIsicSuggestions(q, scored);
}
function autoFillSectorFromIsic(entry) {
  if (!entry?.sector || !entry?.subsector || !sectorBox || !subsectorBox) return;

  const sectorExists = Array.from(sectorBox.options).some(option => option.value === entry.sector);
  if (!sectorExists) return;

  sectorBox.value = entry.sector;
  populateSubsectors();

  const subsectorExists = Array.from(subsectorBox.options).some(option => option.value === entry.subsector);
  if (subsectorExists) {
    subsectorBox.value = entry.subsector;
  }

  sectorBox.classList.add("auto-filled");
  subsectorBox.classList.add("auto-filled");
}

function isCurrentSelectedIsicValue() {
  if (!selectedIsic || !industryBox) return false;
  return industryBox.value.trim() === `${selectedIsic.code} - ${selectedIsic.description}`;
}

function closeIsicDropdown() {
  if (isicDropdown) {
    isicDropdown.classList.add("hidden");
    isicDropdown.innerHTML = "";
    isicDropdown.hidden = true;
    isicDropdown.style.display = "none";
  }
  industryBox?.setAttribute("aria-expanded", "false");
}

function selectIsic(entry) {
  if (!entry || !industryBox) return;
  suppressIsicDropdownUntil = Date.now() + 600;
  selectedIsic = entry;
  industryBox.value = `${entry.code} - ${entry.description}`;
  industryBox.classList.add("valid-selection");
  industryBox.closest(".isic-picker")?.classList.add("selection-complete");
  autoFillSectorFromIsic(entry);

  const autoFillText = entry.sector && entry.subsector
    ? ` Auto-filled sector: ${entry.sector}; subsector: ${entry.subsector}. You can still override them if needed.`
    : "";

  selectedIsicBox.textContent = `Selected: ${entry.code} - ${entry.description}.${autoFillText}`;
  closeIsicDropdown();

  // Keep the interaction feeling complete after a selection. Some browsers fire
  // focus/click events after option selection, so close once immediately and once
  // again on the next frames to prevent the suggestions from reappearing.
  industryBox.blur();
  requestAnimationFrame(closeIsicDropdown);
  window.setTimeout(closeIsicDropdown, 80);
}


function getIsicMatchMeta(entry) {
  const reasons = [];
  if (entry.matchedRoles?.length) reasons.push(entry.matchedRoles.slice(0, 1).join(", "));
  if (entry.matchedDomains?.length) reasons.push(entry.matchedDomains.slice(0, 1).join(", "));
  if (entry.fallbackSuggestion && entry.fallbackReason) reasons.push(entry.fallbackReason);
  if (!reasons.length && entry.subsector) reasons.push(entry.subsector);
  if (!reasons.length && entry.sector) reasons.push(entry.sector);

  const context = [entry.sector, entry.subsector].filter(Boolean).join(" • ");
  const reasonText = reasons.length ? `${entry.fallbackSuggestion ? "Suggested" : "Matched"}: ${reasons.join(" + ")}` : "";
  return [reasonText, context].filter(Boolean).join(" | ");
}

function handleIsicOptionSelection(event) {
  const option = event.target?.closest?.(".isic-option");
  if (!option || !isicDropdown?.contains(option)) return;

  event.preventDefault();
  event.stopPropagation();

  const entry = ISIC_DATA.find(item => item.code === option.dataset.code);
  if (entry) selectIsic(entry);
}

function renderIsicDropdown() {
  if (!isicDropdown || typeof ISIC_DATA === "undefined") return;

  const query = industryBox.value.trim();

  if (industryBox.closest(".isic-picker")?.classList.contains("selection-complete") || isCurrentSelectedIsicValue() || Date.now() < suppressIsicDropdownUntil) {
    closeIsicDropdown();
    return;
  }

  if (!query) {
    isicDropdown.classList.add("hidden");
    industryBox.setAttribute("aria-expanded", "false");
    isicDropdown.innerHTML = "";
    return;
  }

  const matches = getIsicMatches(query);

  if (matches.length === 0) {
    isicDropdown.classList.add("hidden");
    industryBox.setAttribute("aria-expanded", "false");
    isicDropdown.innerHTML = "";
    return;
  }

  const hasFallbackSuggestions = matches.every(entry => entry.fallbackSuggestion);
  const hasStrongQueryMatch = matches.some(entry => entry.queryScore >= 35);
  const fallbackHeading = hasFallbackSuggestions
    ? [...new Set(matches.map(entry => entry.fallbackReason).filter(Boolean))][0]
    : "";
  const heading = hasFallbackSuggestions
    ? (fallbackHeading || (query ? "Suggested ISIC activities to choose from" : "Suggested ISIC activities"))
    : (query ? (hasStrongQueryMatch ? "Closest ISIC matches" : "Related ISIC suggestions") : "Suggested ISIC activities");

  isicDropdown.hidden = false;
  isicDropdown.style.display = "";
  isicDropdown.classList.remove("hidden");
  industryBox.setAttribute("aria-expanded", "true");
  isicDropdown.innerHTML = `
    <div class="isic-dropdown-heading">${heading}</div>
    ${matches.map(entry => `
      <button type="button" class="isic-option" data-code="${entry.code}" role="option">
        <strong>${entry.code}</strong>
        <span>
          <span class="isic-description">${entry.description}</span>
          <small>${getIsicMatchMeta(entry)}</small>
        </span>
      </button>
    `).join("")}
  `;

  isicDropdown.querySelectorAll(".isic-option").forEach(option => {
    const chooseOption = function (event) {
      event.preventDefault();
      event.stopPropagation();
      const entry = ISIC_DATA.find(item => item.code === option.dataset.code);
      if (!entry) return;
      selectIsic(entry);
    };

    option.addEventListener("pointerdown", chooseOption);
    option.addEventListener("mousedown", chooseOption);
    option.addEventListener("click", chooseOption);
  });
}

function countryLabel(country) {
  return `${country.name} (${country.code})`;
}

function getSelectedCurrencies(scope) {
  const selector = scope ? `input[name="${scope}Currency"]:checked` : 'input[name$="Currency"]:checked';
  return Array.from(document.querySelectorAll(selector)).map(input => input.value);
}

function uniqueByCode(countries) {
  const seen = new Set();
  return (countries || []).filter(country => {
    if (!country?.code || seen.has(country.code)) return false;
    seen.add(country.code);
    return true;
  });
}

function getTradeFlow() {
  return {
    purchase: {
      domestic: Boolean(purchaseDomesticBox?.checked),
      international: Boolean(purchaseInternationalBox?.checked),
      countries: selectedPurchaseCountries.map(country => ({ name: country.name, code: country.code, label: countryLabel(country) })),
      currencies: getSelectedCurrencies("purchase")
    },
    sales: {
      domestic: Boolean(salesDomesticBox?.checked),
      international: Boolean(salesInternationalBox?.checked),
      countries: selectedSalesCountries.map(country => ({ name: country.name, code: country.code, label: countryLabel(country) })),
      currencies: getSelectedCurrencies("sales")
    }
  };
}

function getSelectedTradeRolesFromFlow(tradeFlow) {
  const roles = [];
  if (tradeFlow?.purchase?.international) roles.push("importer");
  if (tradeFlow?.sales?.international) roles.push("exporter");
  return roles.length ? roles : ["domestic"];
}

function getAllTradeFlowCountries(tradeFlow) {
  return uniqueByCode([...(tradeFlow?.purchase?.countries || []), ...(tradeFlow?.sales?.countries || [])]);
}

function populateSectors() {
  Object.keys(SECTOR_DATA).forEach(sector => {
    const option = document.createElement("option");
    option.value = sector;
    option.textContent = sector;
    sectorBox.appendChild(option);
  });
}

function populateSubsectors() {
  const sector = sectorBox.value;
  subsectorBox.innerHTML = "";

  if (!sector) {
    subsectorBox.disabled = true;
    subsectorBox.innerHTML = `<option value="">Select a sector first</option>`;
    return;
  }

  subsectorBox.disabled = false;
  subsectorBox.innerHTML = `<option value="">Select a subsector</option>`;

  SECTOR_DATA[sector].forEach(subsector => {
    const option = document.createElement("option");
    option.value = subsector;
    option.textContent = subsector;
    subsectorBox.appendChild(option);
  });
}

function getCountryOptions(search, selected) {
  const term = (search || "").toLowerCase().trim();
  return COUNTRIES
    .map(([name, code]) => ({ name, code }))
    .filter(country => country.code !== "TH" && country.name.toLowerCase() !== "thailand")
    .filter(country => countryLabel(country).toLowerCase().includes(term))
    .map(country => ({ ...country, checked: selected.some(c => c.code === country.code) }));
}

function closeCountryDropdownFor(side) {
  const isPurchase = side === "purchase";
  const searchBox = isPurchase ? purchaseCountrySearch : salesCountrySearch;
  const dropdown = isPurchase ? purchaseCountryDropdown : salesCountryDropdown;
  const picker = searchBox?.closest(".country-picker");
  suppressCountryDropdownUntil[side] = Date.now() + 500;
  picker?.classList.add("selection-complete");
  dropdown?.classList.add("hidden");
  if (dropdown) dropdown.style.display = "none";
  searchBox?.blur();
  requestAnimationFrame(() => {
    dropdown?.classList.add("hidden");
    if (dropdown) dropdown.style.display = "none";
  });
}

function openCountryDropdownFor(side) {
  const isPurchase = side === "purchase";
  const searchBox = isPurchase ? purchaseCountrySearch : salesCountrySearch;
  const dropdown = isPurchase ? purchaseCountryDropdown : salesCountryDropdown;
  const picker = searchBox?.closest(".country-picker");
  if (!dropdown || Date.now() < suppressCountryDropdownUntil[side]) return;
  picker?.classList.remove("selection-complete");
  dropdown.style.display = "";
  dropdown.classList.remove("hidden");
}

function renderCountryDropdownFor(side) {
  const isPurchase = side === "purchase";
  const searchBox = isPurchase ? purchaseCountrySearch : salesCountrySearch;
  const dropdown = isPurchase ? purchaseCountryDropdown : salesCountryDropdown;
  const selected = isPurchase ? selectedPurchaseCountries : selectedSalesCountries;
  if (!searchBox || !dropdown) return;
  if (Date.now() < suppressCountryDropdownUntil[side] || searchBox.closest(".country-picker")?.classList.contains("selection-complete")) {
    dropdown.classList.add("hidden");
    dropdown.style.display = "none";
    return;
  }

  const filtered = getCountryOptions(searchBox.value, selected);
  dropdown.innerHTML = filtered.map(country => `
    <label class="country-option">
      <input type="checkbox" value="${country.code}" ${country.checked ? "checked" : ""}>
      ${countryLabel(country)}
    </label>
  `).join("");

  dropdown.querySelectorAll("input").forEach(box => {
    box.addEventListener("change", function () {
      const country = COUNTRIES.map(([name, code]) => ({ name, code })).find(c => c.code === box.value);
      if (!country) return;
      if (isPurchase) {
        selectedPurchaseCountries = box.checked
          ? uniqueByCode([...selectedPurchaseCountries, country])
          : selectedPurchaseCountries.filter(c => c.code !== country.code);
      } else {
        selectedSalesCountries = box.checked
          ? uniqueByCode([...selectedSalesCountries, country])
          : selectedSalesCountries.filter(c => c.code !== country.code);
      }
      renderSelectedCountriesFor(side);
      searchBox.value = "";
      closeCountryDropdownFor(side);
    });
  });
}

function renderSelectedCountriesFor(side) {
  const isPurchase = side === "purchase";
  const selected = isPurchase ? selectedPurchaseCountries : selectedSalesCountries;
  const box = isPurchase ? selectedPurchaseCountriesBox : selectedSalesCountriesBox;
  if (!box) return;

  if (selected.length === 0) {
    box.innerHTML = "";
    return;
  }

  box.innerHTML = selected.map(country => `
    <span class="country-chip">
      ${countryLabel(country)}
      <button type="button" data-code="${country.code}">×</button>
    </span>
  `).join("");

  box.querySelectorAll("button").forEach(btn => {
    btn.addEventListener("click", function () {
      if (isPurchase) selectedPurchaseCountries = selectedPurchaseCountries.filter(c => c.code !== btn.dataset.code);
      else selectedSalesCountries = selectedSalesCountries.filter(c => c.code !== btn.dataset.code);
      renderSelectedCountriesFor(side);
      renderCountryDropdownFor(side);
    });
  });
}

function updateTradeFlowVisibility() {
  purchaseCountryField?.classList.toggle("hidden", !purchaseInternationalBox?.checked);
  salesCountryField?.classList.toggle("hidden", !salesInternationalBox?.checked);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatDisplayDate(value) {
  if (!value) return "";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "2-digit"
  });
}

function formatDisplayRate(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return value || "";
  }

  return number.toFixed(4);
}

function cleanFxPair(pair, base) {
  const rawPair = pair || `${base || ""}THB`;
  return String(rawPair).replace("=X", "");
}

function renderFxContext(text) {
  const existingCard = document.getElementById("fxContextCard");
  const cleanText = String(text || "").trim();

  if (!cleanText) {
    existingCard?.remove();
    return;
  }

  const fxCard = fxOutput?.closest(".result-card");
  const card = existingCard || document.createElement("div");
  card.id = "fxContextCard";
  card.className = "result-card";
  card.innerHTML = `
    <h2>FX Context</h2>
    <div id="fxContextOutput"><p>${escapeHtml(cleanText)}</p></div>
  `;

  if (!existingCard && fxCard) {
    fxCard.insertAdjacentElement("afterend", card);
  }
}

function getFxSeries(fx) {
  return (fx.series || [])
    .map(item => ({
      date: item.date,
      rate: Number(item.rate)
    }))
    .filter(item => item.date && Number.isFinite(item.rate))
    .sort((a, b) => new Date(a.date) - new Date(b.date));
}

function getRateChange(series) {
  if (!series || series.length < 2) return null;
  const first = series[0].rate;
  const last = series[series.length - 1].rate;
  if (!Number.isFinite(first) || !Number.isFinite(last) || first === 0) return null;
  return ((last - first) / first) * 100;
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function buildFxTableRows(series, columns = 3) {
  if (!series || series.length === 0) {
    return `<tr><td colspan="${columns * 2}">No daily data available.</td></tr>`;
  }

  const newestFirst = [...series].reverse();
  const rowsPerColumn = Math.ceil(newestFirst.length / columns);
  const chunks = Array.from({ length: columns }, (_, index) =>
    newestFirst.slice(index * rowsPerColumn, (index + 1) * rowsPerColumn)
  );

  return Array.from({ length: rowsPerColumn }, (_, rowIndex) => {
    const cells = chunks.map(chunk => {
      const item = chunk[rowIndex];
      if (!item) return `<td></td><td></td>`;
      return `<td>${formatDisplayDate(item.date)}</td><td>${formatDisplayRate(item.rate)}</td>`;
    }).join("");
    return `<tr>${cells}</tr>`;
  }).join("");
}

function renderFxCharts(chartConfigs) {
  Object.values(fxCharts).forEach(chart => chart?.destroy?.());
  fxCharts = {};

  if (!window.Chart) {
    document.querySelectorAll(".fx-chart-status").forEach(el => {
      el.textContent = "Chart library could not load. Daily table is still available below.";
    });
    return;
  }

  chartConfigs.forEach(config => {
    const canvas = document.getElementById(config.canvasId);
    if (!canvas || config.series.length === 0) return;

    const rates = config.series.map(item => item.rate);
    const min = Math.min(...rates);
    const max = Math.max(...rates);
    const padding = Math.max((max - min) * 0.12, Math.abs(max || 1) * 0.001);

    fxCharts[config.canvasId] = new Chart(canvas, {
      type: "line",
      data: {
        labels: config.series.map(item => item.date),
        datasets: [{
          label: config.pair,
          data: rates,
          tension: 0.25,
          pointRadius: 0,
          pointHoverRadius: 4,
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: "index",
          intersect: false
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: items => formatDisplayDate(items?.[0]?.label),
              label: item => `${config.pair}: ${formatDisplayRate(item.raw)}`
            }
          }
        },
        scales: {
          x: {
            grid: {
              color: ctx => config.majorTicks.has(ctx.tick?.value) ? "rgba(0,0,0,0.18)" : "rgba(0,0,0,0.05)",
              lineWidth: ctx => config.majorTicks.has(ctx.tick?.value) ? 1.2 : 0.5
            },
            ticks: {
              autoSkip: false,
              maxRotation: 0,
              callback: value => config.tickLabels[value] || ""
            }
          },
          y: {
            min: min - padding,
            max: max + padding,
            grid: { drawBorder: false },
            ticks: {
              callback: value => Number(value).toFixed(4)
            }
          }
        }
      }
    });
  });
}

function getFxChartAxis(series, tenor) {
  const tickLabels = {};
  const majorTicks = new Set();
  let previousKey = "";

  series.forEach((item, index) => {
    const date = new Date(item.date);
    if (Number.isNaN(date.getTime())) return;

    if (String(tenor) === "90") {
      const key = `${date.getFullYear()}-${date.getMonth()}`;
      if (key !== previousKey || index === 0) {
        tickLabels[index] = date.toLocaleDateString("en-US", { month: "short" });
        majorTicks.add(index);
        previousKey = key;
      }
    } else {
      const day = date.getDay();
      const weekKey = `${date.getFullYear()}-${Math.ceil((date.getDate() + 6) / 7)}-${date.getMonth()}`;
      if ((day === 1 && weekKey !== previousKey) || index === 0 || index === series.length - 1) {
        tickLabels[index] = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
        majorTicks.add(index);
        previousKey = weekKey;
      }
    }
  });

  return { tickLabels, majorTicks };
}

function renderFxResearchDiagnostic(fxResearch) {
  if (!fxResearch) return "";

  const statusText = fxResearch.used
    ? "PDF read successfully"
    : fxResearch.found
      ? "PDF found but not used"
      : fxResearch.attempted
        ? "PDF not read"
        : "PDF not checked";

  const meta = [
    fxResearch.bucket_binding ? `Binding: ${fxResearch.bucket_binding}` : "",
    fxResearch.filename ? `File: ${fxResearch.filename}` : "",
    fxResearch.size_bytes ? `Size: ${Math.round(Number(fxResearch.size_bytes) / 1024)} KB` : ""
  ].filter(Boolean).join(" • ");

  const sections = Array.isArray(fxResearch.extracted_sections) ? fxResearch.extracted_sections : [];
  const sectionHtml = sections.length
    ? sections.map(section => `
        <div class="fx-research-section">
          <strong>${escapeHtml(section.currency || "Currency")}</strong>
          <pre>${escapeHtml(section.text || "No extracted text returned.")}</pre>
        </div>
      `).join("")
    : `<div class="fx-research-empty">No extracted currency section was returned.</div>`;

  return `
    <details class="fx-research-toggle">
      <summary>${escapeHtml(statusText)}${meta ? ` <span>${escapeHtml(meta)}</span>` : ""}</summary>
      <div class="fx-research-body">
        <p>${escapeHtml(fxResearch.extraction_summary || fxResearch.message || "No PDF status message returned.")}</p>
        ${sectionHtml}
      </div>
    </details>
  `;
}

function getFxReferencePoint(series, daysAgo) {
  if (!Array.isArray(series) || !series.length) return null;
  const latestDate = new Date(series[series.length - 1].date);
  if (Number.isNaN(latestDate.getTime())) return series[0];
  const target = new Date(latestDate);
  target.setUTCDate(target.getUTCDate() - daysAgo);

  let candidate = series[0];
  for (const item of series) {
    const itemDate = new Date(item.date);
    if (Number.isNaN(itemDate.getTime())) continue;
    if (itemDate <= target) candidate = item;
    else break;
  }
  return candidate;
}

function getChangeToLatest(latest, reference) {
  if (!latest || !reference || !Number.isFinite(latest.rate) || !Number.isFinite(reference.rate) || reference.rate === 0) return null;
  return ((latest.rate - reference.rate) / reference.rate) * 100;
}

function cleanFxBulletTitle(value, fallback) {
  const cleaned = String(value || "")
    .replace(/^key\s+drivers?\s*[:\-–—]\s*/i, "")
    .replace(/^what\s+to\s+watch\s*[:\-–—]\s*/i, "")
    .replace(/^drivers?\s*[:\-–—]\s*/i, "")
    .trim();
  return cleaned || fallback;
}

function renderFxDriverAnalysis(fx) {
  const analysis = fx?.driver_analysis;
  if (!analysis) return "";
  const drivers = Array.isArray(analysis.drivers) ? analysis.drivers : [];
  const watchItems = Array.isArray(analysis.watch_items) ? analysis.watch_items : [];
  if (!drivers.length && !watchItems.length) return "";

  const driverHtml = drivers.length ? `
    <div class="fx-driver-section">
      <h4>Key drivers</h4>
      <ul>${drivers.map(item => {
        const title = cleanFxBulletTitle(item?.title, "Market factor");
        const explanation = String(item?.explanation || "").trim();
        return `<li><strong>${escapeHtml(title)}${explanation ? ":" : ""}</strong>${explanation ? ` ${escapeHtml(explanation)}` : ""}</li>`;
      }).join("")}</ul>
    </div>
  ` : "";

  const watchHtml = watchItems.length ? `
    <div class="fx-driver-section fx-watch-section">
      <h4>What to watch</h4>
      <ul>${watchItems.map(item => {
        if (typeof item === "string") return `<li>${escapeHtml(item)}</li>`;
        const title = cleanFxBulletTitle(item?.title, "Watch item");
        const explanation = String(item?.explanation || item?.detail || "").trim();
        return `<li><strong>${escapeHtml(title)}${explanation ? ":" : ""}</strong>${explanation ? ` ${escapeHtml(explanation)}` : ""}</li>`;
      }).join("")}</ul>
    </div>
  ` : "";

  return `<div class="fx-driver-analysis">${driverHtml}${watchHtml}</div>`;
}

function renderFxResearchReference(fx, fxResearch) {
  if (!fxResearch?.used || !fxResearch?.url) return "";
  const pair = String(fx?.pair || "").replace(/=X$/i, "");
  const excerpt = (fxResearch.excerpts || []).find(item => String(item.pair || "") === pair)?.excerpt || "";
  return `
    <details class="fx-research-reference">
      <summary>Internal analysis reference</summary>
      <div class="fx-research-reference-body">
        <a href="${escapeHtml(fxResearch.url)}" target="_blank" rel="noopener noreferrer">Open ${escapeHtml(fxResearch.filename || "weekly FX analysis")}</a>
        ${excerpt ? `<p>${escapeHtml(excerpt)}</p>` : `<p>No pair-specific excerpt was extracted.</p>`}
      </div>
    </details>
  `;
}

function renderFxDerivationNote(fx) {
  const base = String(fx?.base || cleanFxPair(fx?.pair, fx?.base).replace(/THB$/i, "")).toUpperCase();
  const currencySide = {
    CNY: "Renminbi",
    EUR: "Euro",
    JPY: "Yen"
  }[base];

  if (!currencySide) return "";
  return `<div class="fx-derivation-note">Movement reflects both Baht-side and ${escapeHtml(currencySide)}-side factors</div>`;
}

function renderFx(fxList, fxResearch = null) {
  Object.values(fxCharts).forEach(chart => chart?.destroy?.());
  fxCharts = {};

  if (!fxList || fxList.length === 0) {
    fxOutput.innerHTML = `<div>No FX data returned.</div>`;
    return;
  }

  const nonThb = fxList.filter(fx => !fx.skip && !fx.error);
  const errors = fxList.filter(fx => fx.error);

  if (nonThb.length === 0 && errors.length === 0) {
    fxOutput.innerHTML = "";
    return;
  }

  const chartConfigs = [];
  const fxCards = nonThb.map((fx, index) => {
    const series = getFxSeries(fx);
    if (!series.length) return "";
    const latest = series[series.length - 1];
    const points = [7, 30, 90].map(days => {
      const reference = getFxReferencePoint(series, days);
      return { days, reference, change: getChangeToLatest(latest, reference) };
    });
    const base = String(fx.base || cleanFxPair(fx.pair, fx.base).replace(/THB$/i, ""));
    const pair = cleanFxPair(fx.pair, fx.base);
    const canvasId = `fxChart-${index}-${pair.replace(/[^A-Za-z0-9]/g, "")}`;
    const axis = getFxChartAxis(series, 90);
    chartConfigs.push({ canvasId, pair, series, ...axis });

    return `
      <section class="fx-card-row fx-inline-card">
        <div class="fx-card-topline">
          <div>
            <div class="fx-title">THB per ${escapeHtml(base)}</div>
            ${renderFxDerivationNote(fx)}
          </div>
        </div>

        <div class="fx-snapshot-row">
          <div class="fx-snapshot fx-snapshot-latest">
            <span>Latest</span>
            <strong>${formatDisplayRate(latest.rate)}</strong>
            <small>${formatDisplayDate(latest.date)}</small>
          </div>
          ${points.map(point => `
            <div class="fx-snapshot">
              <span>${point.days}D</span>
              <strong>${formatPercent(point.change)}</strong>
              <small>${formatDisplayDate(point.reference?.date)} · ${formatDisplayRate(point.reference?.rate)}</small>
            </div>
          `).join("")}
        </div>

        <details class="fx-more-details">
          <summary>See more details</summary>
          <div class="fx-more-details-body">
            <div class="fx-chart-panel fx-chart-panel-full">
              <div class="fx-history-heading">90-day movement</div>
              <div class="fx-chart-wrap">
                <canvas id="${canvasId}"></canvas>
                <div class="fx-chart-status"></div>
              </div>
            </div>

            ${renderFxDriverAnalysis(fx)}

            <details class="fx-subdetails fx-full-rates">
              <summary>View full rates</summary>
              <div class="fx-rate-table-panel">
                <div class="fx-table-scroll">
                  <table class="fx-rate-history-table">
                    <thead><tr><th>Date</th><th>Rate</th><th>Date</th><th>Rate</th><th>Date</th><th>Rate</th></tr></thead>
                    <tbody>${buildFxTableRows(series, 3)}</tbody>
                  </table>
                </div>
              </div>
            </details>

            ${renderFxResearchReference(fx, fxResearch)}
          </div>
        </details>
      </section>
    `;
  }).join("");

  const errorBlocks = errors.map(fx => `
    <div class="fx-block"><span class="error">${escapeHtml(fx.base)}THB: ${escapeHtml(fx.error)}</span></div>
  `).join("");

  fxOutput.innerHTML = `<div class="fx-card-stack">${fxCards}${errorBlocks}</div>`;
  requestAnimationFrame(() => {
    renderFxCharts(chartConfigs);
    document.querySelectorAll(".fx-more-details").forEach(details => {
      details.addEventListener("toggle", () => {
        if (!details.open) return;
        requestAnimationFrame(() => {
          Object.values(fxCharts).forEach(chart => {
            chart?.resize?.();
            chart?.update?.("none");
          });
        });
      });
    });
  });
}

function renderSources(sources, noRelevantUpdates = false, fallbackTriggered = false) {
  lastSources = Array.isArray(sources) ? sources : [];
  const panel = sourcesOutput?.closest(".sources-panel");
  if (panel) panel.classList.add("hidden");
  if (sourcesOutput) {
    sourcesOutput.innerHTML = lastSources.length
      ? `<div class="source-note">Source links are folded into each selected conversation card.</div>`
      : (noRelevantUpdates ? `<div class="empty-state">No relevant sources were included for this period.</div>` : "");
  }
}

const DEFAULT_VISIBLE_SIGNAL_COUNT = 3;
let lastConversationCards = [];
let conversationCardsExpanded = false;
let conversationBridgeBuilt = false;
let lastBuiltConversationCards = [];
let selectedSignalIndexes = new Set();
let lastSources = [];

const ALLOWED_SIGNAL_TAGS = [
  "FX",
  "Trade",
  "Working capital",
  "Payments",
  "Supply chain",
  "Liquidity",
  "Geopolitics",
  "Rates",
  "Commodities",
  "Sector"
];

function normaliseSignalTag(tag) {
  const clean = String(tag || "").trim().toLowerCase();
  const map = {
    "business model": "Business model",
    "business model and operating activities": "Business model",
    operations: "Business model",
    operational: "Business model",
    production: "Business model",
    logistics: "Business model",
    inventory: "Business model",
    "supply & demand": "Supply & demand",
    "supply and demand": "Supply & demand",
    supplier: "Supply & demand",
    suppliers: "Supply & demand",
    buyer: "Supply & demand",
    buyers: "Supply & demand",
    demand: "Supply & demand",
    "supplier and buyer relationships": "Supply & demand",
    "financial management": "Financial management",
    "working capital": "Financial management",
    liquidity: "Financial management",
    payments: "Financial management",
    payment: "Financial management",
    collections: "Financial management",
    collection: "Financial management",
    fx: "Financial management",
    rates: "Financial management",
    "working capital and financial management": "Financial management",
    "other business areas": "Other business areas",
    geopolitics: "Other business areas",
    policy: "Other business areas",
    regulation: "Other business areas",
    management: "Other business areas",
    "business decisions, policies and developments": "Other business areas"
  };
  return map[clean] || null;
}

function deriveSignalTags(text) {
  const source = String(text || "").toLowerCase();
  const tags = [];
  const add = (tag) => { if (!tags.includes(tag)) tags.push(tag); };

  if (/(supplier|buyer|customer demand|bargaining|counterpart|commercial terms|order volume|minimum order|prepayment|dependency|concentration)/i.test(source)) add("Supply & demand");
  if (/(working capital|cash|liquidity|payment|collection|receivable|payable|funding|currency|fx|rate|hedg|cash cycle)/i.test(source)) add("Financial management");
  if (/(management|ownership|group structure|policy|regulation|geopolit|new market|new factory|strategy|risk appetite)/i.test(source)) add("Other business areas");
  if (/(purchasing|sourcing|inventory|production|capacity|delivery|logistics|invoice|reconciliation|operations|operating cycle|shipping)/i.test(source)) add("Business model");

  if (!tags.length) add("Business model");
  return tags.slice(0, 2);
}

function parseTagsFromLine(line) {
  const match = String(line || "").match(/^Tags?\s*:\s*(.+)$/i);
  if (!match) return null;
  const rawTags = match[1]
    .split(/[,|/]+/)
    .map(item => normaliseSignalTag(item))
    .filter(Boolean);
  return [...new Set(rawTags)].slice(0, 3);
}

function normaliseConversationLabel(label) {
  const clean = String(label || "").trim().toLowerCase();
  const labelMap = {
    "comment on context": "Comment on context",
    "context": "Comment on context",
    "what is happening": "Comment on context",
    "link to client": "Link to client",
    "relevance": "Link to client",
    "why it may be relevant": "Link to client",
    "plain-english context": "Link to client",
    "plain english context": "Link to client",
    "background cue": "Relate",
    "why this may matter": "Relate",
    "client relevance lens": "Relate",
    "transaction banking angle": "Relate",
    "relate": "Relate",
    "keep in mind": "Keep in mind",
    "what could change": "Keep in mind",
    "possible implications": "Keep in mind",
    "baseline": "Keep in mind",
    "base case": "Keep in mind",
    "baseline scenario": "Keep in mind",
    "baseline scenarios": "Keep in mind",
    "baseline & scenarios": "Keep in mind",
    "baseline and scenarios": "Keep in mind",
    "scenario frame": "Keep in mind",
    "uncertainty frame": "Keep in mind",
    "useful observation": "Comment on context",
    "useful observation to offer": "Comment on context",
    "gentle observation": "Comment on context",
    "observe": "Comment on context",
    "soft invitation": "Allow room",
    "leave space": "Allow room",
    "allow room": "Allow room",
    "if client engages": "Explore lightly",
    "if they pick up on it": "Explore lightly",
    "lightly explore": "Explore lightly",
    "explore lightly": "Explore lightly",
    "bank relevance": "Reaffirm support",
    "bank angle": "Reaffirm support",
    "bank angle / handoff": "Reaffirm support",
    "handoff cue": "Reaffirm support",
    "offer support": "Reaffirm support",
    "reaffirm support": "Reaffirm support",
    "propose support": "Reaffirm support",
    "propose support path": "Reaffirm support"
  };
  return labelMap[clean] || label || "Relate";
}

function conversationSectionClass(label) {
  const normalised = normaliseConversationLabel(label).toLowerCase();
  if (normalised === "comment on context") return "conversation-section hero-observation observe-section";
  if (normalised === "link to client") return "conversation-section background-cue relate-section";
  if (normalised === "explore lightly") return "conversation-section follow-up-path explore-section";
  if (normalised === "allow room") return "conversation-section soft-invitation leave-space-section";
  if (normalised === "reaffirm support") return "conversation-section bank-handoff support-section";
  return "conversation-section";
}

function mergeAdjacentConversationSections(sections) {
  const order = ["Comment on context", "Link to client", "Explore lightly", "Allow room", "Reaffirm support"];
  const byLabel = new Map();

  sections.forEach(section => {
    const label = normaliseConversationLabel(section.label);
    const text = String(section.text || "").trim();
    if (!text) return;
    const existing = byLabel.get(label);
    byLabel.set(label, existing ? `${existing} ${text}`.trim() : text);
  });

  const merged = [];
  order.forEach(label => {
    if (byLabel.has(label)) merged.push({ label, text: byLabel.get(label) });
  });
  byLabel.forEach((text, label) => {
    if (!order.includes(label)) merged.push({ label, text });
  });
  return merged;
}

function parseConversationCardBlock(block) {
  const lines = String(block || "")
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean);

  const heading = stripSourceMarkers(lines.shift() || "Card");
  const sections = [];
  let tags = [];
  const sourceNumbers = new Set(extractSourceNumbers(block));
  const sectionPattern = /^(Comment on context|Context|What is happening|Link to client|Relevance|Why it may be relevant|Explore lightly|Allow room|Reaffirm support|Observe|Relate|Leave Space|Lightly Explore|Offer Support|Propose Support Path|Background cue|Plain-English context|Plain English context|Client relevance lens|Transaction banking angle|Useful observation(?: to offer)?|Gentle observation|Soft invitation|If they pick up on it|If client engages|Bank angle(?: \/ handoff)?|Bank relevance|Handoff cue)\s*:\s*(.*)$/i;
  let current = null;

  lines.forEach(line => {
    const parsedTags = parseTagsFromLine(line);
    if (parsedTags) {
      tags = parsedTags;
      current = null;
      return;
    }

    const parsedSourceRefs = parseSourceRefsFromLine(line);
    if (parsedSourceRefs) {
      parsedSourceRefs.forEach(number => sourceNumbers.add(number));
      current = null;
      return;
    }

    const match = line.match(sectionPattern);
    if (match) {
      current = {
        label: normaliseConversationLabel(match[1]),
        text: stripSourceMarkers(match[2] || "")
      };
      sections.push(current);
    } else if (current) {
      current.text = stripSourceMarkers(`${current.text} ${line}`);
    } else {
      sections.push({ label: "Link to client", text: stripSourceMarkers(line) });
    }
  });

  const mergedSections = mergeAdjacentConversationSections(sections);
  if (!tags.length) {
    tags = deriveSignalTags(`${heading}\n${mergedSections.map(section => section.text).join("\n")}`);
  }
  return { heading, tags, sections: mergedSections, sourceNumbers: [...sourceNumbers].sort((a, b) => a - b) };
}

function renderSignalTags(tags) {
  const cleanTags = (Array.isArray(tags) ? tags : [])
    .map(normaliseSignalTag)
    .filter(Boolean)
    .filter((tag, index, array) => array.indexOf(tag) === index)
    .slice(0, 3);
  if (!cleanTags.length) return "";
  return `<div class="signal-tag-row">${cleanTags.map(tag => `<span class="signal-tag">${escapeHtml(tag)}</span>`).join("")}</div>`;
}

function getConversationSectionText(card, label) {
  const wanted = normaliseConversationLabel(label);
  const section = (card.sections || []).find(item => normaliseConversationLabel(item.label) === wanted);
  return String(section?.text || "").trim();
}

function extractSourceNumbers(text) {
  const refs = new Set();
  const regex = /\[(\d+)\]/g;
  let match;
  while ((match = regex.exec(String(text || ""))) !== null) {
    const number = Number(match[1]);
    if (Number.isFinite(number)) refs.add(number);
  }
  return [...refs].sort((a, b) => a - b);
}

function stripSourceMarkers(text) {
  return String(text || "")
    .replace(/\s*\[(?:\d+)(?:\s*,\s*\d+)*\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseSourceRefsFromLine(line) {
  const match = String(line || "").match(/^(?:Sources?|Source refs?|Source numbers?)\s*:\s*(.+)$/i);
  if (!match) return null;
  return extractSourceNumbers(match[1]);
}

function getSourceDisplayNumber(source, index) {
  return Number(source?.number || source?.source_number || index + 1);
}

function getSourcesForCard(card) {
  const refs = Array.isArray(card.sourceNumbers) ? card.sourceNumbers : [];
  if (!refs.length || !Array.isArray(lastSources) || !lastSources.length) return [];
  const byNumber = new Map(lastSources.map((source, index) => [getSourceDisplayNumber(source, index), source]));
  return refs
    .map(number => ({ number, source: byNumber.get(Number(number)) }))
    .filter(item => item.source);
}

function renderCardSources(card) {
  const sources = getSourcesForCard(card);
  if (!sources.length) return "";
  const sourceItems = sources.map(({ number, source }) => {
    const title = source.title || source.url || `Source ${number}`;
    const meta = [source.domain || source.source || "Source", source.published_at || "Unknown date"].filter(Boolean).join(" • ");
    return `
      <li>
        <a href="${escapeHtml(source.url || "#")}" target="_blank" rel="noopener noreferrer">${escapeHtml(title)}</a>
        <span>${escapeHtml(meta)}</span>
      </li>
    `;
  }).join("");
  return `
    <details class="bridge-source-footer">
      <summary>Sources</summary>
      <ol>${sourceItems}</ol>
    </details>
  `;
}

function renderSignalSourceLine(card) {
  const sources = getSourcesForCard(card);
  if (!sources.length) return "";
  const links = sources.slice(0, 3).map(({ number, source }) => {
    const label = source.domain || source.source || source.title || `Source ${number}`;
    return `<a href="${escapeHtml(source.url || "#")}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
  }).join(" <span aria-hidden=\"true\">•</span> ");
  return `<div class="signal-source-line">Sources: ${links}</div>`;
}

function resetConversationBridge() {
  conversationBridgeBuilt = false;
  lastBuiltConversationCards = [];
  if (bridgeOutput) bridgeOutput.innerHTML = "";
  if (bridgePanel) bridgePanel.classList.add("hidden");
}

function getSignalContextText(card) {
  return stripSourceMarkers(
    getConversationSectionText(card, "Comment on context") ||
    (card.sections || []).map(section => section.text).find(Boolean) ||
    "A potentially relevant market development was identified"
  );
}

function getSignalRelevanceText(card) {
  return stripSourceMarkers(
    getConversationSectionText(card, "Link to client") ||
    "This may be worth keeping in view for the selected client profile"
  );
}

function renderSignalSelectionCard(card, index) {
  const cleanHeading = card.heading.replace(/^(Card\s+\d+\s*:\s*)/i, "").trim() || `Signal ${index + 1}`;
  const context = getSignalContextText(card);
  const relevance = getSignalRelevanceText(card);
  const checked = selectedSignalIndexes.has(index) ? "checked" : "";

  return `
    <div class="signal-selection-card" data-signal-index="${index}">
      <label class="signal-select-row">
        <input type="checkbox" class="signal-select-checkbox" data-signal-index="${index}" ${checked}>
        <span>Use in client conversation</span>
      </label>
      <div class="signal-card-topline">
        ${renderSignalTags(card.tags)}
        <span class="signal-rank">#${index + 1}</span>
      </div>
      <h3>${escapeHtml(cleanHeading)}</h3>
      <div class="signal-preview-label">Comment on context</div>
      <p class="signal-preview-text">${escapeHtml(context)}</p>
      <div class="signal-preview-label signal-link-label">Link to client</div>
      <p class="signal-preview-text">${escapeHtml(relevance)}</p>
      ${renderSignalSourceLine(card)}
    </div>
  `;
}

function normalizeSectionLabel(label) {
  return String(label || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function renderExploreItems(items) {
  if (!items.length) return "";
  return `
    <div class="conversation-guidance">Articulate the possible client experience without assuming it applies</div>
    <div class="conversation-question-list">
      ${items.map(item => `
        <div class="conversation-question-item">
          <div class="conversation-question">${escapeHtml(item.question)}</div>
        </div>
      `).join("")}
    </div>
  `;
}

function renderAllowItems(items) {
  if (!items.length) return "";
  return `
    <div class="conversation-guidance">Ask one gentle question, then follow what feels relevant to the client</div>
    <div class="conversation-cue-list">
      ${items.map(item => `
        <div class="conversation-cue-item">
          <strong>${escapeHtml(item.focus)}</strong>
          ${item.meaning ? `<span>${escapeHtml(item.meaning)}</span>` : ""}
        </div>
      `).join("")}
    </div>
  `;
}

function renderSupportItems(items) {
  if (!items.length) return "";
  return `
    <div class="conversation-guidance">If a clear need emerges, reflect it back and offer a proportionate next step</div>
    <div class="conversation-support-list">
      ${items.map(item => `
        <div class="conversation-support-item">
          <strong>${escapeHtml(item.when)}</strong>
          ${item.response ? `<span>${escapeHtml(item.response)}</span>` : ""}
        </div>
      `).join("")}
    </div>
  `;
}

function renderBridgeCard(card, index) {
  const cleanHeading = card.heading.replace(/^(Card\s+\d+\s*:\s*)/i, "").trim() || `Card ${index + 1}`;
  const orderedItems = [
    { label: "Comment on context", move: "C" },
    { label: "Link to client", move: "L" },
    { label: "Explore lightly", move: "E" },
    { label: "Allow room", move: "A" },
    { label: "Reaffirm support", move: "R" }
  ];

  const sectionHtml = orderedItems.map(item => {
    const section = (card.sections || []).find(entry => normalizeSectionLabel(entry.label) === normalizeSectionLabel(item.label));
    if (!section) return "";

    const text = stripSourceMarkers(section.text || "");
    let contentHtml = "";

    if (item.label === "Explore lightly") {
      contentHtml = renderExploreItems(section.exploreItems || []);
    } else if (item.label === "Allow room") {
      contentHtml = renderAllowItems(section.allowItems || []);
    } else if (item.label === "Reaffirm support") {
      contentHtml = renderSupportItems(section.supportItems || []);
    } else if (text) {
      contentHtml = `<div class="conversation-text">${escapeHtml(text)}</div>`;
    }

    if (!contentHtml) return "";

    return `
      <div class="${conversationSectionClass(item.label)} bridge-step bridge-step-${item.move.toLowerCase()}">
        <div class="bridge-step-marker">${item.move}</div>
        <div class="bridge-step-body">
          <div class="conversation-label">${escapeHtml(item.label)}</div>
          ${contentHtml}
        </div>
      </div>
    `;
  }).join("");

  return `
    <div class="theme-card conversation-card bridge-card">
      <div class="signal-card-topline">
        ${renderSignalTags(card.tags)}
        <span class="signal-rank">Card ${index + 1}</span>
      </div>
      <h3>${escapeHtml(cleanHeading)}</h3>
      <div class="bridge-step-list">${sectionHtml}</div>
      ${renderCardSources(card)}
    </div>
  `;
}

function renderSelectedConversationBridge() {
  const cards = conversationBridgeBuilt && lastBuiltConversationCards.length
    ? lastBuiltConversationCards
    : [];

  if (!cards.length) {
    return `<div class="empty-state bridge-empty">Select at least one signal to build your client conversation.</div>`;
  }

  return `
    <div class="bridge-output">
      ${cards.map((card, index) => renderBridgeCard(card, index)).join("")}
    </div>
  `;
}

function serializeSelectedSignal(card) {
  return {
    title: card.heading.replace(/^(Card\s+\d+\s*:\s*)/i, "").trim(),
    tags: card.tags || [],
    context: getSignalContextText(card),
    relevance: getSignalRelevanceText(card),
    sourceNumbers: card.sourceNumbers || []
  };
}

function normalizeConversationList(value) {
  if (Array.isArray(value)) return value.map(item => String(item || "").trim()).filter(Boolean);
  const text = String(value || "").trim();
  if (!text) return [];
  return text.split(/\n+/).map(item => item.replace(/^[•\-*]\s*/, "").trim()).filter(Boolean);
}

function normalizeExploreItems(value) {
  if (!Array.isArray(value)) return [];
  return value.map(item => {
    if (typeof item === "string") {
      const text = item.trim();
      return text ? { question: text, whyAsk: "", listenFor: "" } : null;
    }
    const question = String(item?.question || "").trim();
    if (!question) return null;
    return {
      question,
      whyAsk: String(item?.whyAsk || item?.why || "").trim(),
      listenFor: String(item?.listenFor || item?.listen || "").trim()
    };
  }).filter(Boolean);
}

function normalizeAllowItems(value) {
  if (!Array.isArray(value)) return [];
  return value.map(item => {
    if (typeof item === "string") {
      const text = item.trim();
      return text ? { focus: text, meaning: "", followLead: "" } : null;
    }
    const focus = String(item?.focus || item?.cue || "").trim();
    if (!focus) return null;
    return {
      focus,
      meaning: String(item?.meaning || item?.mayIndicate || "").trim(),
      followLead: String(item?.followLead || item?.followUp || "").trim()
    };
  }).filter(Boolean);
}

function normalizeSupportItems(value) {
  if (!Array.isArray(value)) return [];
  return value.map(item => {
    if (typeof item === "string") {
      const text = item.trim();
      return text ? { when: text, response: "" } : null;
    }
    const when = String(item?.when || item?.clientRaises || "").trim();
    if (!when) return null;
    return {
      when,
      response: String(item?.response || item?.support || "").trim()
    };
  }).filter(Boolean);
}

function apiConversationCardToParsed(card, index) {
  return {
    heading: `Card ${index + 1}: ${String(card.title || `Signal ${index + 1}`).trim()}`,
    tags: Array.isArray(card.tags) ? card.tags : [],
    sourceNumbers: Array.isArray(card.sourceNumbers) ? card.sourceNumbers : [],
    sections: [
      { label: "Comment on context", text: String(card.commentOnContext || "").trim() },
      { label: "Link to client", text: String(card.linkToClient || "").trim() },
      { label: "Explore lightly", exploreItems: normalizeExploreItems(card.exploreLightly) },
      { label: "Allow room", allowItems: normalizeAllowItems(card.allowRoom) },
      { label: "Reaffirm support", supportItems: normalizeSupportItems(card.reaffirmSupport) }
    ].filter(section => section.text || section.exploreItems?.length || section.allowItems?.length || section.supportItems?.length)
  };
}

async function buildSelectedConversation() {
  const selected = [...selectedSignalIndexes]
    .sort((a, b) => a - b)
    .map(index => lastConversationCards[index])
    .filter(Boolean);
  if (!selected.length) return;

  const buildButton = document.getElementById("buildBridgeButton");
  if (buildButton) {
    buildButton.disabled = true;
    buildButton.textContent = "Building conversation…";
  }
  if (bridgePanel && bridgeOutput) {
    bridgePanel.classList.remove("hidden");
    bridgeOutput.innerHTML = `<span class="loading">Building a CLEAR conversation from the selected signals…</span>`;
  }

  const tradeFlow = getTradeFlow();
  const profile = {
    sector: sectorBox?.value || "",
    subsector: subsectorBox?.value || "",
    industry: selectedIsic ? selectedIsic.description : (industryBox?.value || "").trim(),
    purchaseFlow: tradeFlow.purchase.domestic || tradeFlow.purchase.international
      ? `${tradeFlow.purchase.domestic ? "Thailand domestic" : ""}${tradeFlow.purchase.domestic && tradeFlow.purchase.international ? "; " : ""}${tradeFlow.purchase.international ? tradeFlow.purchase.countries.map(country => country.name || country.label).join(", ") : ""}`
      : "",
    salesFlow: tradeFlow.sales.domestic || tradeFlow.sales.international
      ? `${tradeFlow.sales.domestic ? "Thailand domestic" : ""}${tradeFlow.sales.domestic && tradeFlow.sales.international ? "; " : ""}${tradeFlow.sales.international ? tradeFlow.sales.countries.map(country => country.name || country.label).join(", ") : ""}`
      : ""
  };

  try {
    const response = await fetch("/api/conversation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ signals: selected.map(serializeSelectedSignal), profile })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Conversation generation failed");
    const cards = Array.isArray(data.cards) ? data.cards.map(apiConversationCardToParsed) : [];
    if (!cards.length) throw new Error("No conversation cards were returned");
    lastBuiltConversationCards = cards;
    conversationBridgeBuilt = true;
    if (bridgeOutput) bridgeOutput.innerHTML = renderSelectedConversationBridge();
    bridgePanel?.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    if (bridgeOutput) bridgeOutput.innerHTML = `<span class="error">${escapeHtml(error.message || "Conversation generation failed")}</span>`;
  } finally {
    const currentButton = document.getElementById("buildBridgeButton");
    if (currentButton) {
      currentButton.disabled = !selectedSignalIndexes.size;
      currentButton.textContent = `Build client conversation${selectedSignalIndexes.size ? ` (${selectedSignalIndexes.size})` : ""}`;
    }
  }
}

function renderSignalSelectionList() {
  const visibleLimit = conversationCardsExpanded ? lastConversationCards.length : DEFAULT_VISIBLE_SIGNAL_COUNT;
  const visibleCards = lastConversationCards.slice(0, visibleLimit);
  const hiddenCount = Math.max(0, lastConversationCards.length - DEFAULT_VISIBLE_SIGNAL_COUNT);
  const selectedCount = selectedSignalIndexes.size;

  const cardsHtml = visibleCards.map((card, index) => renderSignalSelectionCard(card, index)).join("");
  const toggleHtml = hiddenCount > 0 ? `
    <button type="button" class="secondary-action" id="toggleSignals">
      ${conversationCardsExpanded ? "Show fewer signals" : `Show ${hiddenCount} more signal${hiddenCount === 1 ? "" : "s"}`}
    </button>
  ` : "";

  analysisOutput.innerHTML = `
    <div class="signals-summary">Showing ${visibleCards.length} of ${lastConversationCards.length} Client Signal${lastConversationCards.length === 1 ? "" : "s"}. Select only the signals you may want to use in a client conversation.</div>
    <div class="signal-selection-list">${cardsHtml}</div>
    <div class="signal-action-row">
      ${toggleHtml}
      <button type="button" class="secondary-action primary-bridge-action" id="buildBridgeButton" ${selectedCount ? "" : "disabled"}>
        Build client conversation${selectedCount ? ` (${selectedCount})` : ""}
      </button>
    </div>
  `;

  if (conversationBridgeBuilt && bridgeOutput && bridgePanel) {
    bridgeOutput.innerHTML = renderSelectedConversationBridge();
    bridgePanel.classList.remove("hidden");
  } else if (!conversationBridgeBuilt) {
    resetConversationBridge();
  }

  document.querySelectorAll(".signal-select-checkbox").forEach(input => {
    input.addEventListener("change", event => {
      const index = Number(event.currentTarget.getAttribute("data-signal-index"));
      if (!Number.isFinite(index)) return;
      if (event.currentTarget.checked) {
        selectedSignalIndexes.add(index);
      } else {
        selectedSignalIndexes.delete(index);
      }
      conversationBridgeBuilt = false;
      renderSignalSelectionList();
    });
  });

  document.getElementById("toggleSignals")?.addEventListener("click", () => {
    conversationCardsExpanded = !conversationCardsExpanded;
    renderSignalSelectionList();
  });

  document.getElementById("buildBridgeButton")?.addEventListener("click", buildSelectedConversation);
}

function renderConversationCards(text) {
  const cardBlocks = String(text || "")
    .split(/(?=Card\s+\d+\s*:)/i)
    .map(block => block.trim())
    .filter(Boolean);

  if (cardBlocks.length === 0) return false;

  lastConversationCards = cardBlocks.map(parseConversationCardBlock);
  conversationCardsExpanded = false;
  resetConversationBridge();
  selectedSignalIndexes = new Set();
  renderSignalSelectionList();
  return true;
}

function renderAnalysis(text) {
  if (!text) {
    resetConversationBridge();
    analysisOutput.textContent = "No analysis returned.";
    return;
  }

  if (renderConversationCards(text)) return;

  const themeBlocks = text
    .split(/(?=Theme\s+\d+\s*:)/i)
    .map(block => block.trim())
    .filter(Boolean);

  if (themeBlocks.length === 0) {
    resetConversationBridge();
    analysisOutput.textContent = text;
    return;
  }

  analysisOutput.innerHTML = themeBlocks.map(block => {
    const lines = block
      .split("\n")
      .map(line => line.trim())
      .filter(Boolean);

    const heading = lines[0] || "Theme";
    const bodyLines = lines.slice(1);

    const bulletLines = bodyLines.filter(line => line.startsWith("-"));
    const metaLines = bodyLines.filter(line =>
      /^signal strength:/i.test(line) ||
      /^evidence score:/i.test(line) ||
      /^evidence basis:/i.test(line) ||
      line.includes(" | Evidence score:")
    );
    const paragraphLines = bodyLines.filter(line =>
      !line.startsWith("-") &&
      !line.toLowerCase().startsWith("supporting information") &&
      !(/^signal strength:/i.test(line) || /^evidence score:/i.test(line) || /^evidence basis:/i.test(line) || line.includes(" | Evidence score:"))
    );

    const meta = metaLines.join(" ");
    const paragraph = paragraphLines.join(" ");

    const bullets = bulletLines.map(line => {
      const clean = line.replace(/^-+\s*/, "");
      return `<li>${escapeHtml(clean)}</li>`;
    }).join("");

    return `
      <div class="theme-card">
        <h3>${escapeHtml(heading)}</h3>
        ${meta ? `<div class="theme-meta">${escapeHtml(meta)}</div>` : ""}
        ${paragraph ? `<p>${escapeHtml(paragraph)}</p>` : ""}
        ${bullets ? `<ul>${bullets}</ul>` : ""}
      </div>
    `;
  }).join("");
}


function normaliseContextPoints(context) {
  if (!context) return [];

  if (Array.isArray(context.points)) {
    return context.points;
  }

  if (Array.isArray(context)) {
    return context;
  }

  if (typeof context === "string") {
    return context
      .split(/\n+/)
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => ({
        title: "Industry context",
        explanation: line.replace(/^\d+[.)]\s*/, ""),
        rm_considerations: []
      }));
  }

  return [];
}

function renderContext(context) {
  if (!contextOutput) return;

  const points = normaliseContextPoints(context);

  if (points.length === 0) {
    contextOutput.textContent = "No industry context returned.";
    return;
  }

  contextOutput.innerHTML = points.map(point => {
    const title = point.title || "Industry context";
    const explanation = point.explanation || point.text || "";
    const considerations = point.rm_considerations || point.rmConsiderations || point.considerations || [];

    return `
      <div class="context-point-card">
        <h3>${title}</h3>
        ${explanation ? `<p>${explanation}</p>` : ""}
        ${considerations.length ? `
          <ul>
            ${considerations.map(item => `<li>${item}</li>`).join("")}
          </ul>
        ` : ""}
      </div>
    `;
  }).join("");
}



async function fetchMarketIntelligence({ showLoading = false } = {}) {
  const tradeFlow = getTradeFlow();
  const currencies = [...new Set([...(tradeFlow.purchase.currencies || []), ...(tradeFlow.sales.currencies || [])])];
  const sector = sectorBox?.value || "";
  const subsector = subsectorBox?.value || "";
  const industry = selectedIsic ? selectedIsic.description : (industryBox?.value || "").trim();
  const isicCode = selectedIsic?.code || "";
  const fxTenor = fxTenorBox?.value || "30";
  const tradeRoles = getSelectedTradeRolesFromFlow(tradeFlow);
  const countries = getAllTradeFlowCountries(tradeFlow);

  if (!fxOutput) return false;

  if (currencies.length === 0) {
    fxOutput.textContent = "Please select at least one currency.";
    return false;
  }

  if (showLoading) {
    fxOutput.innerHTML = `<span class="loading">Loading market intelligence...</span>`;
  }

  try {
    const response = await fetch("/api/fx", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        currencies,
        sector,
        subsector,
        industry,
        isicCode,
        fxTenor,
        tradeRoles,
        countries,
        tradeFlow
      })
    });

    const data = await response.json();

    if (!response.ok) {
      fxOutput.innerHTML = `<span class="error">${escapeHtml(data.error || "Market intelligence update failed.")}</span>`;
      return false;
    }

    renderFx(data.fx || [], data.fxResearch || null);
    return true;
  } catch (error) {
    fxOutput.innerHTML = `<span class="error">Market intelligence network error.</span>`;
    return false;
  }
}

function attachCoreInputListeners() {
  industryBox?.addEventListener("input", function () {
    suppressIsicDropdownUntil = 0;
    selectedIsic = null;
    industryBox.classList.remove("valid-selection");
    industryBox.closest(".isic-picker")?.classList.remove("selection-complete");
    if (selectedIsicBox) {
      selectedIsicBox.textContent = "Select one suggested ISIC activity. Free-text entries are not accepted as final input.";
    }
    renderIsicDropdown();
  });

  industryBox?.addEventListener("focus", function () {
    if (isCurrentSelectedIsicValue()) {
      closeIsicDropdown();
      return;
    }
    renderIsicDropdown();
  });
  industryBox?.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      closeIsicDropdown();
    }
  });

  document.addEventListener("click", function (event) {
    if (!event.target.closest(".isic-picker")) {
      closeIsicDropdown();
    }
  });

  ["pointerdown", "mousedown", "click"].forEach(eventName => {
    isicDropdown?.addEventListener(eventName, handleIsicOptionSelection, true);
  });

  [purchaseInternationalBox, salesInternationalBox].forEach(box => {
    box?.addEventListener("change", updateTradeFlowVisibility);
  });

  function attachCountryPicker(side, searchBox, dropdown) {
    searchBox?.addEventListener("focus", function () {
      openCountryDropdownFor(side);
      renderCountryDropdownFor(side);
    });
    searchBox?.addEventListener("input", function () {
      suppressCountryDropdownUntil[side] = 0;
      searchBox.closest(".country-picker")?.classList.remove("selection-complete");
      openCountryDropdownFor(side);
      renderCountryDropdownFor(side);
    });
  }

  attachCountryPicker("purchase", purchaseCountrySearch, purchaseCountryDropdown);
  attachCountryPicker("sales", salesCountrySearch, salesCountryDropdown);

  document.addEventListener("click", function (event) {
    if (!event.target.closest('.country-picker[data-picker="purchase"]')) {
      purchaseCountryDropdown?.classList.add("hidden");
      if (purchaseCountryDropdown) purchaseCountryDropdown.style.display = "none";
    }
    if (!event.target.closest('.country-picker[data-picker="sales"]')) {
      salesCountryDropdown?.classList.add("hidden");
      if (salesCountryDropdown) salesCountryDropdown.style.display = "none";
    }
  });
}

function getSignalThreads() {
  const checked = Array.from(document.querySelectorAll('input[name="signalThread"]:checked'))
    .map(input => input.value)
    .filter(Boolean);

  return checked.length
    ? checked
    : ["sector_news", "fx_rates", "geopolitics", "trade_supply_chain", "commodities", "macro_indicators"];
}


function getClientProfile() {
  return {};
}

function attachGenerateSignalsUnlockListeners() {
  const setupRoot = document.querySelector(".preparation-main");
  if (!setupRoot) return;

  const handleSetupChange = event => {
    if (isSetupChangingTarget(event.target)) unlockGenerateSignalsForSetupChange();
  };

  setupRoot.addEventListener("input", handleSetupChange, true);
  setupRoot.addEventListener("change", handleSetupChange, true);
  setupRoot.addEventListener("click", handleSetupChange, true);
}

attachGenerateSignalsUnlockListeners();

button.addEventListener("click", async function () {
  const sector = sectorBox.value;
  const subsector = subsectorBox.value;
  const industry = selectedIsic ? selectedIsic.description : industryBox.value.trim();
  const isicCode = selectedIsic?.code || "";
  const timeframe = timeframeBox.value;
  const fxTenor = fxTenorBox?.value || "30";
  const conversationGoal = "general_check_in";
  const clientProfile = getClientProfile();
  const signalThreads = getSignalThreads();
  const tradeFlow = getTradeFlow();
  const currencies = [...new Set([...(tradeFlow.purchase.currencies || []), ...(tradeFlow.sales.currencies || [])])];
  const tradeRoles = getSelectedTradeRolesFromFlow(tradeFlow);
  const countries = getAllTradeFlowCountries(tradeFlow);

  const defaultPrompt = defaultPromptBox.value.trim();

  if (!sector) {
    analysisOutput.textContent = "Please select a sector.";
    return;
  }

  if (!subsector) {
    analysisOutput.textContent = "Please select a subsector.";
    return;
  }

  if (!selectedIsic) {
    analysisOutput.textContent = "Please select one ISIC activity from the suggestions.";
    return;
  }

  if (!tradeFlow.purchase.domestic && !tradeFlow.purchase.international) {
    analysisOutput.textContent = "Please select domestic and/or international for Purchase from.";
    return;
  }

  if (!tradeFlow.sales.domestic && !tradeFlow.sales.international) {
    analysisOutput.textContent = "Please select domestic and/or international for Sales to.";
    return;
  }

  if (tradeFlow.purchase.international && tradeFlow.purchase.countries.length === 0) {
    analysisOutput.textContent = "Please select at least one international purchase market.";
    return;
  }

  if (tradeFlow.sales.international && tradeFlow.sales.countries.length === 0) {
    analysisOutput.textContent = "Please select at least one international sales market.";
    return;
  }

  if (tradeFlow.purchase.currencies.length === 0) {
    analysisOutput.textContent = "Please select at least one purchase currency.";
    return;
  }

  if (tradeFlow.sales.currencies.length === 0) {
    analysisOutput.textContent = "Please select at least one sales currency.";
    return;
  }

  signalRequestInFlight = true;
  signalRunLocked = false;
  updateGenerateSignalsButtonState();
  let signalRunSucceeded = false;
  resetConversationBridge();
  analysisOutput.innerHTML = `<span class="loading">Researching relevant signals...</span>`;
  renderFxContext("");
  if (sourcesOutput) sourcesOutput.innerHTML = `<span class="loading">Loading sources...</span>`;
  if (contextOutput) contextOutput.textContent = "";

  const marketIntelligencePromise = fetchMarketIntelligence({ showLoading: true });

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        sector,
        subsector,
        industry,
        isicCode,
        tradeRoles,
        tradeFlow,
        timeframe,
        fxTenor,
        currencies,
        countries,
        defaultPrompt,
        conversationGoal,
        clientProfile,
        signalThreads
      })
    });

    const data = await response.json();

    if (!response.ok) {
      analysisOutput.innerHTML = `<span class="error">${data.error || "Request failed."}</span>`;
      if (sourcesOutput) sourcesOutput.textContent = "";
      if (contextOutput) contextOutput.textContent = "";
      return;
    }

    renderSources(data.sources || [], Boolean(data.no_relevant_updates), Boolean(data.fallback_triggered));
    const analysisText = data.news?.content || data.analysis || "";
    renderAnalysis(analysisText || "No analysis returned.");
    signalRunSucceeded = Boolean(String(analysisText).trim());

    const marketIntelligenceRendered = await marketIntelligencePromise;
    if (!marketIntelligenceRendered && Array.isArray(data.fx)) {
      renderFx(data.fx || [], data.fxResearch || null);
    }

    // Industry Context & RM Considerations is currently deactivated in the UI.
    // renderContext(data.context || "");
  } catch (error) {
    analysisOutput.innerHTML = `<span class="error">Network error.</span>`;
    if (sourcesOutput) sourcesOutput.textContent = "";
    if (contextOutput) contextOutput.textContent = "";
  } finally {
    signalRequestInFlight = false;
    if (signalRunSucceeded) signalRunLocked = true;
    updateGenerateSignalsButtonState();
  }
});

populateSectors();
populateSubsectors();
renderCountryDropdownFor("purchase");
renderCountryDropdownFor("sales");
updateTradeFlowVisibility();
attachCoreInputListeners();

sectorBox?.addEventListener("change", function () {
  sectorBox.classList.remove("auto-filled");
  subsectorBox.classList.remove("auto-filled");
  populateSubsectors();
  if (document.activeElement === industryBox) renderIsicDropdown();
});
subsectorBox?.addEventListener("change", function () {
  subsectorBox.classList.remove("auto-filled");
  if (document.activeElement === industryBox) renderIsicDropdown();
});
