# AI Buyer Cost Learning V1.1 — Structured Specs & Conservative Cohort Matching

## Goal
Extract CPU, GPU, RAM, SSD, screen, brand, family, and model codes from Thai/English AMPHON System inventory names for Owner/Admin review, without inventing missing information or modifying active pricing.

## Matching policy
- Extract as **CONFIDENT/COMPLETE**, **PARTIAL**, or **UNKNOWN**. Any missing brand/family/core specs, known defect phrase, or contradictory memory fields results in a warning. Never assume blank GPU means integrated GPU.
- Only complete NOTEBOOK specs with a known model code use a canonical cohort key: category, brand, model family, exact model code, CPU, GPU (or explicit UNSPECIFIED), RAM, SSD, screen, and original recorded condition. Equivalent name formatting can be grouped; different GPU/RAM/SSD/condition never merge.
- All other entries retain **strict normalized full source name + source category** grouping. These are historical references only, not automatic comparable market listings.
- Numeric cost-learning suggestions require the existing 3 distinct verified purchase-and-sold products, positive recorded realized profit, recent (within 180 days) sale, and **complete specifications and no condition warnings**. Otherwise all price proposal fields stay blank until the owner verifies specs and market pricing.
- The system does NOT rewrite the original 646 staging entries, invent current market data, derive absent repair/ship expenses, or send offers.

## Validation
`node --test scripts/verify-ai-buyer-structured-specs.test.mjs` covers real AMPHON used notebook spec forms, GPU aliases, RAM/SSD variants, model-code mismatch, condition and damaged notebooks, phone storage, Apple silicon, and family unknown. The existing `verify-ai-buyer-cost-learning.test.mjs` also validates 3 independent sold stock codes and failure for loss-making cases.

## Limitations / next steps
- Legacy historical names are inconsistent. Brand/CPU/GPU parsers are deterministic patterns, **not authoritative model identification**. Owner should check original device/model and visually verify when a code is missing.
- Complete structured equivalence currently supports notebook variants with recognized model codes; desktops, phones, cameras, and MacBooks retain conservative exact-name grouping pending category-specific matching policy.
- To use matched historical costs for **live LINE** price replies, independently verify historical outliers, hardware condition, current comparable sale price, margins and expenses. Build the approval/rollback and worker E2E gates before enabling.
