# Unit economics: CineHD Cameroon — scenario A: owned catalog (rights acquired outright)

Every number below comes from the input file. Nothing is looked up or guessed.

## One subscriber-month

| line | per subscriber-month |
| --- | ---: |
| Price | $2,000.00 |
| CinetPay collect (2.8% + 100 XAF on 2 000) | -$156.00 |
| CinetPay withdrawal to mobile money (2%) | -$40.00 |
| CDN delivery, ~10 GB/sub/month at ~$0.015/GB (estimate) | -$100.00 |
| **Contribution** (what each subscriber-month leaves to pay the fixed costs) | **$1,704.00** (85%) |

## The margin that matters

Fixed costs: $560,000 a month (Infra: app, DB, Redis, DRM, analytics, backups $120,000, Dev + ops, part-time $200,000, Customer support (WhatsApp / phone) $60,000, Legal, accounting, compliance $60,000, Marketing baseline $120,000).

- **Break-even: 329 subscriber-months a day.** Below that you lose money every month.
- **Profit margin at your plan** (545 a day): **34%** of every sale, after every cost.
- Capacity: 30000 a day.

## Year 1, month by month

| month | subscriber-months a day | revenue | profit | cumulative (after $1,700,000 startup) |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 10 | $20,000 | -$542,960 | -$2,242,960 |
| 2 | 35 | $70,000 | -$500,360 | -$2,743,320 |
| 3 | 70 | $140,000 | -$440,720 | -$3,184,040 |
| 4 | 110 | $220,000 | -$372,560 | -$3,556,600 |
| 5 | 160 | $320,000 | -$287,360 | -$3,843,960 |
| 6 | 215 | $430,000 | -$193,640 | -$4,037,600 |
| 7 | 270 | $540,000 | -$99,920 | -$4,137,520 |
| 8 | 325 | $650,000 | -$6,200 | -$4,143,720 |
| 9 | 380 | $760,000 | $87,520 | -$4,056,200 |
| 10 | 435 | $870,000 | $181,240 | -$3,874,960 |
| 11 | 490 | $980,000 | $274,960 | -$3,600,000 |
| 12 | 545 | $1,090,000 | $368,680 | -$3,231,320 |

- **Year 1 operating profit: -$1,531,320** on $6,090,000 of revenue.
- After the $1,700,000 startup spend: -$3,231,320.
- Startup money earned back: not within year 1.
- Cash you need before it pays for itself: **$4,143,720**.

## What if

| scenario | margin at plan | break-even a day | year 1 profit |
| --- | ---: | ---: | ---: |
| Base plan | 34% | 329 | -$1,531,320 |
| Price -10% | 26% | 373 | -$2,140,320 |
| Volume -20% | 21% | 329 | -$2,569,056 |
| Unit costs +15% | 32% | 338 | -$1,666,518 |

## Red flags

- Year 1 loses money on operations (-$1,531,320).
- The startup spend is not earned back within year 1.
