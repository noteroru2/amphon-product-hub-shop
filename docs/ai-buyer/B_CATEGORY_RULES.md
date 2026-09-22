# AI Buyer Optimization — B. Category Rules

Version: 1.0  
Source of truth for machine-readable rules: `workers/ai-buyer/data/optimization-policy-v1.json`

## Notebook

Ready by complete spec when brand, series/model, CPU, GPU/integrated graphics, RAM and storage are confirmed. Minimum identity confidence 0.80. A clear exact model code can attempt market fallback rather than waiting indefinitely for more photos.

Do not block on charger photo, accessories, battery health or extra cosmetic angles.

Automatic deductions currently supported: battery bad -800, no charger -500, rough body -1,000, missing key -800, keyboard backlight -300, keyboard defect -1,500, touchpad -800, speaker -500, webcam -400, mic -300, audio jack -300, one USB port -600, Wi-Fi/Bluetooth -700, fingerprint -300, fan abnormal -700 THB.

Human review / high-risk deductions: hinge -1,500, screen -2,000, charging port -1,200, thermal overheat -1,200, multiple ports -1,500, board-repair history -2,500, liquid history -3,000, intermittent power -3,500, major damage -4,000, not booting -5,000 THB.

## Desktop PC

Ready by spec when CPU, GPU/integrated graphics, RAM, storage, motherboard and PSU are confirmed. Minimum identity confidence 0.65 because custom PCs often do not have a commercial model name.

Do not ask for a full-case photo when these six pricing components are already confirmed unless there is a mapping conflict or more than one machine is being discussed.

Automatic: rough condition -800 THB. Human review: instability -2,500, major damage -3,500, PSU risk -800, low SSD health -500 THB.

## Smartphone

Ready when exact model and storage variant are confirmed with identity confidence >= 0.90. Battery health, front/back/frame photos, box and accessories are not prerequisites for the first price.

Deductions: BATTERY_BAD -800, no box -200, heavy body wear -700, screen defect -2,000, missing accessory -200 THB.

Locked / not booting / major damage / ambiguous variant => Human Review.

## Tablet

Ready when exact model and storage variant are confirmed with identity confidence >= 0.90.

Deductions: BATTERY_BAD -800, no charger -300, no box -200, heavy body wear -700, screen defect -1,800, missing accessory -300 THB.

Locked / not booting / major damage / ambiguous variant => Human Review.

## MacBook

Ready when model/model code, chip or year, and storage are known with identity confidence >= 0.90. RAM should be captured when available but must not force endless photo requests if the model/variant is already priceable.

Deductions: BATTERY_BAD -1,500, no charger -500, no box -300, heavy body wear -1,000, screen defect -2,500, hinge issue -1,500, missing accessory -300 THB.

Locked / not booting / major damage / ambiguous variant => Human Review.

## Camera

Ready when brand + exact model are known with identity confidence >= 0.90. For interchangeable-lens cameras, distinguish body-only vs lens bundle when the bundle changes resale value.

Deductions: battery bad -500, no charger -500, no box -200, heavy body wear -700, screen defect -1,000, missing accessory -500 THB.

Not booting / major damage / variant ambiguity / multiple-device ambiguity => Human Review.

## Other

No automatic pricing by default. Identify product/brand/model and route to Human Review until a dedicated category Price Book or market rule is approved.

## Cross-category photo rule

Only request evidence that changes identity, variant, function or price. Never request a photo just to increase a completeness score.

If the necessary evidence is already present in text, a label, About screen or system screen, clear the related requested input.

## Cross-category defect rule

A known defect is sticky. It cannot disappear because a later message or image omits it. New evidence may add defects or correct a false positive, but correction must be explicit and auditable.

## Price safety

All deductions are applied before creating opening/target/hard-max values. No conversational path can exceed hard max. Market fallback requires verified comparable sources and must fail to Human Review if source count or dispersion is unsafe.
