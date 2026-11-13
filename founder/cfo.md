# Unit economics: CineHD Cameroon — base case: licensed catalog at 30% revenue share

> **Currency note:** the tool prints `$`. Every figure here is **XAF (FCFA)**.
> The unit is one **subscriber-month**, and `days_per_month` is set to 1, so
> "break-even a day" below reads as **break-even subscribers**.

## CFO's note

### The three scenarios

Same ramp in all three (10 → 545 paying subscribers over 12 months), same fixed
costs. Only the content deal changes.

| | A — owned catalog | B — 30 % revenue share | C — 1 500 000 XAF/month MG |
| --- | ---: | ---: | ---: |
| Contribution per subscriber-month | **1 704** (85 %) | **1 104** (55 %) | **1 704** (85 %) |
| Fixed cost a month | 560 000 | 560 000 | 2 060 000 |
| **Break-even subscribers** | **329** | **508** | **1 209** |
| Margin at 545 subscribers | **34 %** | **4 %** | **−104 %** |
| Year 1 operating profit | −1 531 320 | −3 358 320 | −19 531 320 |
| Cash needed before payback | **4 143 720** | **7 100 000** | **23 231 320** |
| Startup spend earned back | month ~21 | **never at 545 subs** | never |

### The margin

At the decided price of 2 000 XAF, one subscriber-month leaves **1 104 XAF**
(55 %) after its own costs if content is a 30 % revenue share, and **1 704 XAF**
(85 %) if the catalog is owned. Fixed costs are 560 000 XAF a month, so
**break-even is 508 subscribers on a revenue share, 329 on an owned catalog.**

### The line to watch: the price, not the cost

Price is the dominant variable, and it is the one the brief already fixed.

| Owned catalog | Break-even subs | Margin at 545 | Year 1 operating |
| --- | ---: | ---: | ---: |
| 2 000 XAF | 329 | 34 % | −1 531 320 |
| 2 500 XAF | 255 | 47 % | −8 820 |
| 3 000 XAF | 208 | 56 % | **+1 513 680** |

| 30 % revenue share | Break-even subs | Margin at 545 | Year 1 operating |
| --- | ---: | ---: | ---: |
| 2 000 XAF | 508 | 4 % | −3 358 320 |
| 2 500 XAF | 350 | 23 % | −1 835 820 |

**+500 XAF on the price is worth more than owning the catalog.** It is the
difference between a year-1 loss of 1.53 M and a year-1 loss of 9 000.

Two things make the 2 000 XAF figure fragile:

1. **It sits at the market floor.** Resold Netflix accounts sell at 2 000–3 500
   XAF in Cameroon, IPTV at ~3 000, Showmax from ~1 800, official Netflix mobile
   ~1 800. CineHD at 2 000 is not undercutting anyone; it is matching the
   grey-market price with a licensed catalog.
2. **The discount ladder destroys the margin it buys.** The 12-month tier at
   16 000 XAF is 1 333/month. Moving a subscriber onto it drops contribution
   from 1 704 to ~1 160, and break-even from 329 to **483** subscribers. The
   prepay helps cash flow, not profit. The same ladder at −10 % instead of −33 %
   (12-month at 21 600) keeps break-even at **349**.

### Cash

- **Owned catalog: 4 143 720 XAF** (~6 900 USD) before the business pays for
  itself, at a ~21-month payback on this ramp.
- **30 % revenue share: 7 100 000 XAF** (~11 800 USD), and at 545 subscribers
  the monthly profit is 41 680 — a 169-month payback. On this ramp it never
  earns the startup back. It needs ~1 000 subscribers before payback drops to
  about 13 months.

### Three ways to improve the margin

1. **Raise the price to 2 500.** Break-even 329 → 255 subscribers (−74), margin
   34 % → 47 %, year 1 −1 531 320 → −8 820. This is the single largest lever and
   costs nothing to implement.
2. **Own the catalog rather than pay a 30 % revenue share.** Contribution
   1 104 → 1 704, break-even 508 → 329, year 1 −3 358 320 → −1 531 320. This is
   the difference between a business that pays back and one that does not.
3. **Tighten the annual discount from −33 % to −10 %** (12-month 16 000 →
   21 600). Break-even 483 → 349 subscribers, while still collecting the cash
   upfront.

### Board conditions

`founder/board.md` does not exist yet, so the board's conditions on money cannot
be checked. Run `/founder-board` first if you want that gate.

Revenue is before tax. An accountant should check the company structure, payroll
and tax treatment in Cameroon before money moves. Not financial, tax or legal
advice.

---

Every number below comes from the input file. Nothing is looked up or guessed.

## One subscriber-month

| line | per subscriber-month |
| --- | ---: |
| Price | $2,000.00 |
| CinetPay collect (2.8% + 100 XAF on 2 000) | -$156.00 |
| CinetPay withdrawal to mobile money (2%) | -$40.00 |
| CDN delivery, ~10 GB/sub/month at ~$0.015/GB (estimate) | -$100.00 |
| Content royalty, 30% of net revenue (estimate — replace with a signed quote) | -$600.00 |
| **Contribution** (what each subscriber-month leaves to pay the fixed costs) | **$1,104.00** (55%) |

## The margin that matters

Fixed costs: $560,000 a month (Infra: app, DB, Redis, DRM, analytics, backups $120,000, Dev + ops, part-time $200,000, Customer support (WhatsApp / phone) $60,000, Legal, accounting, compliance $60,000, Marketing baseline $120,000).

- **Break-even: 508 subscriber-months a day.** Below that you lose money every month.
- **Profit margin at your plan** (545 a day): **4%** of every sale, after every cost.
- Capacity: 30000 a day.

## Year 1, month by month

| month | subscriber-months a day | revenue | profit | cumulative (after $3,700,000 startup) |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 10 | $20,000 | -$548,960 | -$4,248,960 |
| 2 | 35 | $70,000 | -$521,360 | -$4,770,320 |
| 3 | 70 | $140,000 | -$482,720 | -$5,253,040 |
| 4 | 110 | $220,000 | -$438,560 | -$5,691,600 |
| 5 | 160 | $320,000 | -$383,360 | -$6,074,960 |
| 6 | 215 | $430,000 | -$322,640 | -$6,397,600 |
| 7 | 270 | $540,000 | -$261,920 | -$6,659,520 |
| 8 | 325 | $650,000 | -$201,200 | -$6,860,720 |
| 9 | 380 | $760,000 | -$140,480 | -$7,001,200 |
| 10 | 435 | $870,000 | -$79,760 | -$7,080,960 |
| 11 | 490 | $980,000 | -$19,040 | -$7,100,000 |
| 12 | 545 | $1,090,000 | $41,680 | -$7,058,320 |

- **Year 1 operating profit: -$3,358,320** on $6,090,000 of revenue.
- After the $3,700,000 startup spend: -$7,058,320.
- Startup money earned back: not within year 1.
- Cash you need before it pays for itself: **$7,100,000**.

## What if

| scenario | margin at plan | break-even a day | year 1 profit |
| --- | ---: | ---: | ---: |
| Base plan | 4% | 508 | -$3,358,320 |
| Price -10% | -7% | 620 | -$3,967,320 |
| Volume -20% | -9% | 508 | -$4,030,656 |
| Unit costs +15% | -3% | 578 | -$3,767,568 |

## Red flags

- Year 1 loses money on operations (-$3,358,320).
- The startup spend is not earned back within year 1.
