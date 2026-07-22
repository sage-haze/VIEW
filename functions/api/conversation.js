function extractOutputText(data) {
  if (data?.output_text) return data.output_text;
  if (!Array.isArray(data?.output)) return "";
  return data.output.flatMap(item => Array.isArray(item?.content) ? item.content : [])
    .filter(item => item?.type === "output_text" && item?.text)
    .map(item => item.text)
    .join("");
}

function parseJsonObject(text) {
  try {
    const start = String(text || "").indexOf("{");
    const end = String(text || "").lastIndexOf("}");
    if (start < 0 || end < start) return null;
    return JSON.parse(String(text).slice(start, end + 1));
  } catch (_) {
    return null;
  }
}

function cleanSignal(signal, index) {
  return {
    title: String(signal?.title || `Signal ${index + 1}`).trim(),
    context: String(signal?.context || "").trim(),
    relevance: String(signal?.relevance || "").trim(),
    tags: Array.isArray(signal?.tags) ? signal.tags.map(String).slice(0, 3) : [],
    sourceNumbers: Array.isArray(signal?.sourceNumbers)
      ? [...new Set(signal.sourceNumbers.map(Number).filter(Number.isFinite))].slice(0, 6)
      : []
  };
}

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    if (!env.OPENAI_API_KEY) {
      return Response.json({ error: "Missing OPENAI_API_KEY secret in Cloudflare." }, { status: 500 });
    }

    const body = await request.json();
    const signals = (Array.isArray(body.signals) ? body.signals : []).map(cleanSignal).filter(item => item.title);
    const profile = body.profile && typeof body.profile === "object" ? body.profile : {};

    if (!signals.length) {
      return Response.json({ error: "Please select at least one Client Signal." }, { status: 400 });
    }

    const prompt = `
You are a transaction banking conversation coach supporting a junior relationship manager at a Thailand-based bank.

Create one concise, practical CLEAR conversation card for each selected Client Signal. Use only the selected signal content below. Do not search the web and do not add new market facts.

Client profile:
- Sector: ${String(profile.sector || "")}
- Subsector: ${String(profile.subsector || "")}
- Specific industry: ${String(profile.industry || "")}
- Purchase flow: ${String(profile.purchaseFlow || "")}
- Sales flow: ${String(profile.salesFlow || "")}

CLIENT-UNDERSTANDING REASONING — COMPLETE THIS BEFORE WRITING CLEAR
For each signal, work from the news to the part of the client's business that could potentially be affected.
Use this sequence:
1. Identify the external development shown by the selected signal.
2. Identify the likely transmission into the client's operating reality.
3. Select ONE primary client-understanding area and, only when useful, ONE secondary area.
4. Identify the specific part of the business within those areas that may be affected.
5. Use that focus consistently in Link to client, Explore lightly, Allow room, and Reaffirm support.

The four client-understanding segments, which must also be used as the card tags, are:
A. Business model
- sourcing and purchasing
- receiving goods, inventory and warehousing
- production or service capacity
- delivery and logistics
- invoicing
- making payments
- collecting proceeds
- reconciliation and administration
- investment, expansion and operating continuity

B. Supply & demand
- concentration and dependency
- bargaining power and availability of alternatives
- trust and relationship maturity
- supplier or buyer reliability
- order sizes and minimum quantities
- deposits, prepayment and commercial terms
- payment and collection terms
- trade methods and documentation responsibilities

C. Financial management
- timing of payments and collections
- inventory, debtor and creditor cycles
- seasonal or lumpy cash requirements
- pre-shipment and post-shipment needs
- liquidity buffers and cash visibility
- funding sources
- payment and collection currencies
- natural offsets, currency mismatch and conversion timing

D. Other business areas
- ownership and group structure
- decision-making authority and treasury autonomy
- management preferences and risk appetite
- approved banks, currencies, payment or collection methods
- new factories, products or markets
- changes in suppliers, buyers, ownership or management
- geopolitical, regulatory or natural-disaster triggers

Selection rules:
- Choose the area because it is the clearest business transmission from the signal, not merely because a keyword appears.
- Prefer one coherent route over a list of loosely related implications.
- Use the client profile to make the route relevant, but never invent operating details that are not provided.
- Treat all client effects as possibilities unless directly established by the selected signal and profile.
- Do not jump directly from news to a banking product.
- The selected tag defines the broad territory. Link to client drills down into the specific affected part. Explore lightly articulates the possible client experience. Allow room then lets the client choose the path.

CLEAR structure:
- Comment on context — Begin with a simple observation: summarise the development in 2 concise sentences. Include the most useful facts and enough market context for the banker to understand the signal.
- Link to client — Relate the development gently to the client’s business in 1 or 2 concise sentences. Identify the broad client-understanding segment and the specific part of the business that may be affected. Keep this section directional rather than explanatory; the fuller talking support belongs in Explore lightly. Use conditional language and do not claim the client is affected.
- Explore lightly — Do not ask a question. Give the RM enough grounded, plain-English content to explain the topic confidently without making up facts. Write 2 to 4 concise sentences, normally 45 to 80 words. Start from the specific business mechanism identified in Link to client, then explain: (1) what some comparable businesses may be seeing, (2) why it could matter operationally, and (3) at most one closely connected downstream effect. Use natural spoken language such as “Some of our clients might see…” or “For some businesses, this can show up in…”. Every point must be supported by the selected signal or be clearly framed as a cautious transmission channel. Do not add market facts, forecasts, product recommendations, technical banking language, or a list of unrelated implications.
- Allow room — Ask exactly one short, gentle, open question that hands the conversation to the client. The question should connect naturally to Explore lightly but stay easy to answer. Prefer simple wording such as “Has any of this started to show up for your business?”, “How is this playing out for you?”, or “Does any of this feel relevant for your business?”. Do not combine multiple questions. Add one very short neutral listening cue, but do not prescribe a diagnostic path.
- Reaffirm support — Reflect and offer a helpful next step: provide exactly 2 conditional examples tied to the paths in Allow room. Each should first reflect what the client raised and then offer a proportionate next step. Keep each example to one short sentence and avoid a compulsory product pitch.

Rules:
- Use calm, plain English
- Do not forecast
- Do not invent facts
- Do not imply the client has a problem
- Do not turn Link to client into a list of transaction-banking products
- Do not infer invoice, settlement, or proceeds currency from a country or market. Name a specific currency only when it is explicitly present in the selected signal and supported by the client profile; otherwise use neutral wording such as sales proceeds, payment timing, FX exposure, or receivable timing
- Avoid ambiguous contrasts such as “rather than”, “instead of”, “without assuming”, “despite”, and “although” unless directly necessary and supported
- Explore lightly must be a useful spoken explanation, not a question or diagnostic checklist; target 2 to 4 concise sentences and roughly 45 to 80 words
- Allow room must contain one simple question that is comfortable to answer
- Do not combine several operational questions into one sentence
- The client should be able to answer comfortably with “not really” or “no change” without feeling challenged
- Questions must not force disclosure of loss, cash stress, late payment, or credit weakness
- Reaffirm support must reflect what the client actually raises before suggesting a review, specialist, or product conversation
- Preserve each signal’s sourceNumbers exactly

Return JSON only:
{
  "cards": [
    {
      "title": "Signal title",
      "tags": ["Supply & demand"],
      "clientUnderstanding": {
        "primaryArea": "Supply & demand",
        "secondaryArea": "Business model",
        "affectedPart": "Purchasing lead times, inventory planning and supplier payment timing",
        "conversationDirection": "Understand where the changed timing is being felt across the operating cycle"
      },
      "commentOnContext": "Two concise sentences",
      "linkToClient": "Two concise sentences",
      "exploreLightly": [
        {
          "question": "Some of our clients might see buyers taking longer to confirm orders or asking for more flexibility on price and volume. Even where demand remains, less certainty around orders can make harvest, packing or delivery plans harder to coordinate. If that uncertainty continues, the timing of expected sales proceeds may also become less predictable.",
          "whyAsk": "",
          "listenFor": ""
        }
      ],
      "allowRoom": [
        {
          "focus": "Has any of this started to show up for your business?",
          "meaning": "Listen for the part of the relationship the client chooses to discuss",
          "followLead": ""
        }
      ],
      "reaffirmSupport": [
        {
          "when": "If the client raises a change in purchasing timing",
          "response": "Reflect the timing change and offer to review how it flows through payments and liquidity planning"
        }
      ],
      "sourceNumbers": [1]
    }
  ]
}

Selected signals:
${JSON.stringify(signals, null, 2)}
`.trim();

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: env.OPENAI_ANALYSIS_MODEL || "gpt-4.1",
        input: prompt,
        text: {
          format: {
            type: "json_schema",
            name: "clear_conversation_cards",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                cards: {
                  type: "array",
                  minItems: 1,
                  maxItems: 6,
                  items: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      title: { type: "string" },
                      tags: { type: "array", items: { type: "string" }, maxItems: 3 },
                      clientUnderstanding: {
                        type: "object",
                        additionalProperties: false,
                        properties: {
                          primaryArea: {
                            type: "string",
                            enum: [
                              "Business model",
                              "Supply & demand",
                              "Financial management",
                              "Other business areas"
                            ]
                          },
                          secondaryArea: {
                            type: "string",
                            enum: [
                              "None",
                              "Business model",
                              "Supply & demand",
                              "Financial management",
                              "Other business areas"
                            ]
                          },
                          affectedPart: { type: "string" },
                          conversationDirection: { type: "string" }
                        },
                        required: ["primaryArea", "secondaryArea", "affectedPart", "conversationDirection"]
                      },
                      commentOnContext: { type: "string" },
                      linkToClient: { type: "string" },
                      exploreLightly: {
                        type: "array",
                        minItems: 1,
                        maxItems: 2,
                        items: {
                          type: "object",
                          additionalProperties: false,
                          properties: {
                            question: { type: "string" },
                            whyAsk: { type: "string" },
                            listenFor: { type: "string" }
                          },
                          required: ["question", "whyAsk", "listenFor"]
                        }
                      },
                      allowRoom: {
                        type: "array",
                        minItems: 1,
                        maxItems: 1,
                        items: {
                          type: "object",
                          additionalProperties: false,
                          properties: {
                            focus: { type: "string" },
                            meaning: { type: "string" },
                            followLead: { type: "string" }
                          },
                          required: ["focus", "meaning", "followLead"]
                        }
                      },
                      reaffirmSupport: {
                        type: "array",
                        minItems: 2,
                        maxItems: 2,
                        items: {
                          type: "object",
                          additionalProperties: false,
                          properties: {
                            when: { type: "string" },
                            response: { type: "string" }
                          },
                          required: ["when", "response"]
                        }
                      },
                      sourceNumbers: { type: "array", items: { type: "integer" }, maxItems: 6 }
                    },
                    required: ["title", "tags", "clientUnderstanding", "commentOnContext", "linkToClient", "exploreLightly", "allowRoom", "reaffirmSupport", "sourceNumbers"]
                  }
                }
              },
              required: ["cards"]
            }
          }
        }
      })
    });

    const data = await response.json();
    if (!response.ok) {
      return Response.json({ error: data?.error?.message || "Conversation generation failed." }, { status: 500 });
    }

    const parsed = parseJsonObject(extractOutputText(data));
    if (!parsed || !Array.isArray(parsed.cards)) {
      return Response.json({ error: "Conversation generation returned an unexpected format." }, { status: 500 });
    }

    return Response.json({ cards: parsed.cards });
  } catch (error) {
    return Response.json({ error: error?.message || "Conversation generation failed." }, { status: 500 });
  }
}
