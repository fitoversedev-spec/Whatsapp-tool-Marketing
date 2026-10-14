import { describe, expect, it } from "vitest";
import { detectSensitiveContent, normaliseForGuard } from "../messaging/contentGuard";

const flagged = (t: string) => detectSensitiveContent(t);

describe("content guard: prices and amounts (must be held)", () => {
  const prices = [
    "The court will cost ₹5,00,000",
    "₹5000",
    "Rs. 4,50,000 only",
    "Rs 25000",
    "rs25000",
    "RS.1200",
    "INR 3,25,000",
    "inr3000",
    "around 5 lakh for the whole court",
    "2.5 lakhs approx",
    "10 lac",
    "1 crore project",
    "2.5 cr budget is fine",
    "it comes to 85k",
    "85 K",
    "5k per court",
    "1,50,000",
    "25,000",
    "12,34,567",
    "450 per sq ft",
    "450/sqft",
    "5000/-",
    "5000 /-",
    "the price is on the quote",
    "prices start low",
    "What is your pricing?",
    "total cost will be shared",
    "our rate is competitive",
    "rates differ by surface",
    "installation charges extra",
    "pay the advance payment",
    "payment link sent",
    "GST extra",
    "EMI available",
    "amount payable is fixed",
    "very affordable",
    "it is expensive",
    "50 thousand rupees",
    "paanch hazaar",
    "kimat kya hai",
    "kitna kharcha aayega",
    "$5000",
    "5000 USD",
    "५००० रुपये",
    "PRICE",
    "p​rice",
    "Ｒｓ 5000",
  ];
  it.each(prices)("flags %s", (t) => {
    const r = flagged(t);
    expect(r.flagged).toBe(true);
    expect(r.categories).toContain("price");
  });
});

describe("content guard: discounts and offers (must be held)", () => {
  const discounts = [
    "10% off",
    "get 20 percent extra",
    "50 per cent",
    "special discount for you",
    "Discounts apply",
    "we have an offer running",
    "limited offers",
    "flat 5000 off",
    "it is 10 off today",
    "cashback on booking",
    "use this coupon",
    "festival promo",
    "promotion ends soon",
    "new scheme available",
    "we can waive the fee",
    "free of charge",
    "free installation included",
    "free site visit",
    "for free",
    "no extra charge",
    "at no cost",
    "complimentary maintenance",
  ];
  it.each(discounts)("flags %s", (t) => {
    const r = flagged(t);
    expect(r.flagged).toBe(true);
    expect(r.categories).toContain("discount");
  });
});

describe("content guard: commitments (must be held)", () => {
  const commitments = [
    "The delivery date will be 15th",
    "delivery by Friday",
    "delivery within a week",
    "delivery timeline is 3 weeks",
    "We will install by 20th",
    "installation by Monday",
    "installed within 10 days",
    "installation date is fixed",
    "it will be ready by tomorrow",
    "we will complete the court by month end",
    "we deliver before Diwali",
    "complete it within 30 days",
    "5 year warranty",
    "warranties are standard",
    "100 guarantee",
    "we guarantee quality",
    "guaranteed finish",
    "the deadline is tight",
    "I will confirm the date tomorrow",
    "please confirm the installation date",
    "the date is confirmed",
    "I promise",
    "we assure you",
    "we are committed to this",
    "full refund possible",
    "penalty clause",
    "within 24 hours we will start",
  ];
  it.each(commitments)("flags %s", (t) => {
    const r = flagged(t);
    expect(r.flagged).toBe(true);
    expect(r.categories).toContain("commitment");
  });
});

describe("content guard: ordinary replies pass", () => {
  const fine = [
    "Hello! Thanks for reaching out to Fitoverse. How can I help you today?",
    "Could you share the size of the court, for example 30 x 15 m?",
    "Which sport are you planning: badminton, tennis or football?",
    "Please share your location pin so our team can plan a visit.",
    "Our team will call you shortly.",
    "Thanks, I have noted your city as Bengaluru.",
    "Is this for a school or a private residence?",
    "I have noted that accurately.",
    "Please call 9876543210 if it is urgent.",
    "We have 5 courts in this style.",
    "Your site visit is noted, a colleague will get in touch.",
    "That sounds great, which surface do you prefer?",
    "Happy to help with badminton court flooring.",
    "The court is 1,200 sq ft",
    "Ground is 12,000 sq ft in size",
    "Sure, sending the brochure now.",
    "Good morning",
    "Thank you for your patience",
    "A corporate campus with 2 courts",
    "We can talk tomorrow morning",
    "Reply YES to continue",
    "",
  ];
  it.each(fine)("does not flag %s", (t) => {
    const r = flagged(t);
    expect(r.flagged, JSON.stringify(r)).toBe(false);
    expect(r.categories).toEqual([]);
  });
});

describe("content guard: result shape", () => {
  it("reports every category it finds, with short snippets", () => {
    const r = flagged("Rs 5000 with 10% discount and a 2 year warranty");
    expect(r.flagged).toBe(true);
    expect(r.categories.sort()).toEqual(["commitment", "discount", "price"]);
    expect(r.matches.length).toBeGreaterThan(0);
    expect(r.matches.length).toBeLessThanOrEqual(5);
    for (const m of r.matches) expect(m.length).toBeLessThanOrEqual(40);
  });
  it("is case-insensitive and normalises width and zero-width characters", () => {
    expect(normaliseForGuard("Ｒｓ​ 5")).toBe("rs 5");
    expect(flagged("WARRANTY").flagged).toBe(true);
  });
  it("tolerates non-string input", () => {
    expect(detectSensitiveContent(undefined as unknown as string).flagged).toBe(false);
  });
});
