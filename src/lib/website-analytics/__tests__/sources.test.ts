import { describe, expect, it } from "vitest";
import {
  AI_ASSISTANT_LABELS,
  SOURCE_GROUPS,
  aiSourcePattern,
  classify,
  classifyGaSession,
  parseReferrer,
} from "../sources";

const ref = (referrerHost: string) => classify({ referrerHost });
const label = (referrerHost: string) => ref(referrerHost).label;

describe("classify: nothing known", () => {
  it("no attribution object at all is Unknown", () => {
    expect(classify()).toEqual({ label: "Unknown", group: "Unknown" });
    expect(classify(null)).toEqual({ label: "Unknown", group: "Unknown" });
  });

  it("an attribution with no referrer and no utm is Direct", () => {
    expect(classify({})).toEqual({ label: "Direct", group: "Direct" });
    expect(classify({ referrerHost: null, utmSource: null, utmMedium: null, clickId: null })).toEqual({
      label: "Direct",
      group: "Direct",
    });
    expect(classify({ referrerHost: "  ", utmSource: "" })).toEqual({ label: "Direct", group: "Direct" });
  });

  it("only returns known groups", () => {
    for (const input of [{}, { referrerHost: "chatgpt.com" }, { clickId: "gclid" }, { utmMedium: "email" }]) {
      expect(SOURCE_GROUPS).toContain(classify(input).group);
    }
  });
});

describe("classify: AI assistants", () => {
  it.each([
    ["chatgpt.com", "ChatGPT"],
    ["chat.openai.com", "ChatGPT"],
    ["openai.com", "ChatGPT"],
    ["www.chatgpt.com", "ChatGPT"],
    ["CHATGPT.COM", "ChatGPT"],
    ["gemini.google.com", "Gemini"],
    ["bard.google.com", "Gemini"],
    ["perplexity.ai", "Perplexity"],
    ["www.perplexity.ai", "Perplexity"],
    ["copilot.microsoft.com", "Copilot"],
    ["claude.ai", "Claude"],
    ["meta.ai", "Meta AI"],
    ["poe.com", "Other AI"],
    ["you.com", "Other AI"],
    ["chat.deepseek.com", "Other AI"],
    ["deepseek.com", "Other AI"],
    ["grok.com", "Other AI"],
    ["x.ai", "Other AI"],
    ["chat.mistral.ai", "Other AI"],
  ])("%s -> %s", (host, expected) => {
    expect(ref(host)).toEqual({ label: expected, group: "AI assistants" });
  });

  it("bing.com/chat is Copilot but the rest of Bing is search", () => {
    expect(classify({ referrerHost: "bing.com", referrerPath: "/chat" })).toEqual({ label: "Copilot", group: "AI assistants" });
    expect(classify({ referrerHost: "www.bing.com/chat?q=x" }).label).toBe("Copilot");
    expect(classify({ referrerHost: "https://www.bing.com/chat" }).label).toBe("Copilot");
    expect(classify({ referrerHost: "bing.com", referrerPath: "/search" })).toEqual({ label: "Bing", group: "Search" });
    expect(label("bing.com")).toBe("Bing");
  });

  it("reads utm_source by host or by name, in any case", () => {
    expect(classify({ utmSource: "chatgpt.com" }).label).toBe("ChatGPT");
    expect(classify({ utmSource: "ChatGPT" }).label).toBe("ChatGPT");
    expect(classify({ utmSource: "perplexity" }).label).toBe("Perplexity");
    expect(classify({ utmSource: "gemini" }).label).toBe("Gemini");
    expect(classify({ utmSource: "Meta AI" }).label).toBe("Meta AI");
    expect(classify({ utmSource: "claude.ai" }).label).toBe("Claude");
    expect(classify({ utmSource: "copilot" }).label).toBe("Copilot");
    expect(classify({ utmSource: "deepseek" }).label).toBe("Other AI");
  });

  it("plain 'meta' is Meta advertising, not the Meta AI assistant", () => {
    expect(classify({ utmSource: "meta" }).group).not.toBe("AI assistants");
    expect(classify({ utmSource: "meta", utmMedium: "cpc" })).toEqual({ label: "Meta Ads", group: "Paid ads" });
  });

  it("only exposes the assistant labels", () => {
    expect(AI_ASSISTANT_LABELS).toEqual(["ChatGPT", "Gemini", "Perplexity", "Copilot", "Claude", "Meta AI", "Other AI"]);
  });
});

describe("classify: paid ads", () => {
  it("gclid is Google Ads, whatever else is there", () => {
    expect(classify({ clickId: "gclid" })).toEqual({ label: "Google Ads", group: "Paid ads" });
    expect(classify({ clickId: "gclid", referrerHost: "google.com", utmMedium: "organic" }).label).toBe("Google Ads");
  });

  it.each(["cpc", "ppc", "paid", "paidsearch", "paid_search", "Paid Search", "CPC"])(
    "paid medium %s with a google source is Google Ads",
    (utmMedium) => {
      expect(classify({ utmSource: "google", utmMedium })).toEqual({ label: "Google Ads", group: "Paid ads" });
    },
  );

  it("a google referrer counts as a google source", () => {
    expect(classify({ referrerHost: "www.google.com", utmMedium: "cpc" }).label).toBe("Google Ads");
  });

  it("fbclid with a paid medium is Meta Ads", () => {
    expect(classify({ clickId: "fbclid", utmMedium: "cpc" })).toEqual({ label: "Meta Ads", group: "Paid ads" });
    expect(classify({ clickId: "fbclid", utmMedium: "paid", utmSource: "newsletter" }).label).toBe("Meta Ads");
  });

  it("facebook / instagram / meta source with a paid medium is Meta Ads", () => {
    for (const utmSource of ["facebook", "instagram", "meta", "fb", "ig"]) {
      expect(classify({ utmSource, utmMedium: "paid_social" })).toEqual({ label: "Meta Ads", group: "Paid ads" });
    }
    expect(classify({ referrerHost: "l.facebook.com", utmMedium: "cpc" }).label).toBe("Meta Ads");
  });

  it("any other paid medium is Other ads", () => {
    expect(classify({ utmSource: "bing", utmMedium: "cpc" })).toEqual({ label: "Other ads", group: "Paid ads" });
    expect(classify({ utmSource: "linkedin", utmMedium: "paid" }).label).toBe("Other ads");
    expect(classify({ utmMedium: "ppc" }).label).toBe("Other ads");
  });

  it("msclkid / ttclid / li_fat_id only come from ad clicks", () => {
    for (const clickId of ["msclkid", "ttclid", "li_fat_id"]) {
      expect(classify({ clickId })).toEqual({ label: "Other ads", group: "Paid ads" });
    }
  });

  it("a google source without a paid medium is search, not ads", () => {
    expect(classify({ utmSource: "google", utmMedium: "organic" })).toEqual({ label: "Google search", group: "Search" });
  });
});

describe("classify: search", () => {
  it.each([
    ["google.com", "Google search"],
    ["www.google.com", "Google search"],
    ["google.co.in", "Google search"],
    ["www.google.com.au", "Google search"],
    ["google.de", "Google search"],
    ["bing.com", "Bing"],
    ["www.bing.com", "Bing"],
    ["duckduckgo.com", "Other search"],
    ["search.yahoo.com", "Other search"],
    ["in.search.yahoo.com", "Other search"],
    ["yahoo.co.jp", "Other search"],
    ["yandex.ru", "Other search"],
    ["yandex.com", "Other search"],
    ["ecosia.org", "Other search"],
    ["baidu.com", "Other search"],
  ])("%s -> %s", (host, expected) => {
    expect(ref(host)).toEqual({ label: expected, group: "Search" });
  });

  it("other Google products are not Google search", () => {
    expect(ref("mail.google.com")).toEqual({ label: "Other website", group: "Other websites" });
    expect(ref("docs.google.com").group).toBe("Other websites");
  });
});

describe("classify: social", () => {
  it.each([
    ["instagram.com", "Instagram"],
    ["l.instagram.com", "Instagram"],
    ["facebook.com", "Facebook"],
    ["m.facebook.com", "Facebook"],
    ["l.facebook.com", "Facebook"],
    ["lm.facebook.com", "Facebook"],
    ["fb.com", "Facebook"],
    ["youtube.com", "YouTube"],
    ["m.youtube.com", "YouTube"],
    ["youtu.be", "YouTube"],
    ["linkedin.com", "LinkedIn"],
    ["www.linkedin.com", "LinkedIn"],
    ["lnkd.in", "LinkedIn"],
    ["x.com", "X (Twitter)"],
    ["t.co", "X (Twitter)"],
    ["twitter.com", "X (Twitter)"],
    ["wa.me", "WhatsApp"],
    ["whatsapp.com", "WhatsApp"],
    ["web.whatsapp.com", "WhatsApp"],
    ["pinterest.com", "Pinterest"],
    ["in.pinterest.com", "Pinterest"],
    ["pinterest.co.uk", "Pinterest"],
  ])("%s -> %s", (host, expected) => {
    expect(ref(host)).toEqual({ label: expected, group: "Social" });
  });

  it("utm_source names count too", () => {
    expect(classify({ utmSource: "instagram", utmMedium: "social" }).label).toBe("Instagram");
    expect(classify({ utmSource: "ig" }).label).toBe("Instagram");
    expect(classify({ utmSource: "Facebook" }).label).toBe("Facebook");
    expect(classify({ utmSource: "linkedin" }).label).toBe("LinkedIn");
    expect(classify({ utmSource: "twitter" }).label).toBe("X (Twitter)");
    expect(classify({ utmSource: "whatsapp" }).label).toBe("WhatsApp");
    expect(classify({ utmSource: "youtube" }).label).toBe("YouTube");
  });

  it("fbclid on its own is a click out of Facebook", () => {
    expect(classify({ clickId: "fbclid" })).toEqual({ label: "Facebook", group: "Social" });
    expect(classify({ clickId: "fbclid", referrerHost: "l.instagram.com" }).label).toBe("Instagram");
  });

  it("hosts that merely end the same way are not matched", () => {
    expect(label("box.ai")).toBe("Other website");
    expect(label("mix.com")).toBe("Other website");
    expect(label("notfacebook.com")).toBe("Other website");
  });
});

describe("classify: email, other sites, direct", () => {
  it("utm_medium email / newsletter is Email", () => {
    expect(classify({ utmSource: "mailchimp", utmMedium: "email" })).toEqual({ label: "Email", group: "Email" });
    expect(classify({ utmSource: "october", utmMedium: "Newsletter" }).group).toBe("Email");
    expect(classify({ referrerHost: "mail.google.com", utmMedium: "email" }).group).toBe("Email");
  });

  it("any other referrer host is Other website", () => {
    expect(ref("example.com")).toEqual({ label: "Other website", group: "Other websites" });
    expect(ref("blog.sportsnews.in").group).toBe("Other websites");
  });

  it("a utm_source we don't know, with no referrer, is still not Direct", () => {
    expect(classify({ utmSource: "partner-network" })).toEqual({ label: "Other website", group: "Other websites" });
  });

  it("accepts a full URL or a host with a port as the referrer host", () => {
    expect(label("https://www.ChatGPT.com/c/123")).toBe("ChatGPT");
    expect(label("chatgpt.com:443")).toBe("ChatGPT");
    expect(label("chatgpt.com.")).toBe("ChatGPT");
  });
});

describe("classify: utm_source against the referrer", () => {
  it("a recognised utm_source wins over the referrer", () => {
    expect(classify({ utmSource: "chatgpt.com", referrerHost: "google.com" }).label).toBe("ChatGPT");
    expect(classify({ utmSource: "facebook", referrerHost: "google.com" }).label).toBe("Facebook");
    expect(classify({ utmSource: "instagram", referrerHost: "chatgpt.com" })).toEqual({ label: "Instagram", group: "Social" });
  });

  it("an unrecognised utm_source (a campaign name) falls back to the referrer", () => {
    expect(classify({ utmSource: "spring_sale", referrerHost: "google.com" }).label).toBe("Google search");
    expect(classify({ utmSource: "spring_sale", referrerHost: "example.com" }).group).toBe("Other websites");
  });
});

describe("classifyGaSession", () => {
  it("reads GA source / medium pairs", () => {
    expect(classifyGaSession("(direct)", "(none)")).toEqual({ label: "Direct", group: "Direct" });
    expect(classifyGaSession("google", "organic").label).toBe("Google search");
    expect(classifyGaSession("google", "cpc").label).toBe("Google Ads");
    expect(classifyGaSession("chatgpt.com", "referral")).toEqual({ label: "ChatGPT", group: "AI assistants" });
    expect(classifyGaSession("perplexity.ai", "referral").group).toBe("AI assistants");
    expect(classifyGaSession("l.instagram.com", "referral").label).toBe("Instagram");
    expect(classifyGaSession("t.co", "referral").label).toBe("X (Twitter)");
    expect(classifyGaSession("bing", "organic").label).toBe("Bing");
    expect(classifyGaSession("duckduckgo", "organic").group).toBe("Search");
    expect(classifyGaSession("newsletter", "email").group).toBe("Email");
    expect(classifyGaSession("(not set)", "(not set)").group).toBe("Direct");
    expect(classifyGaSession("blog.example.com", "referral").group).toBe("Other websites");
  });
});

describe("parseReferrer", () => {
  it("returns the host (no www), path and the URL for an http(s) URL", () => {
    expect(parseReferrer("https://www.Bing.com/chat?x=1")).toEqual({
      host: "bing.com",
      path: "/chat",
      url: "https://www.Bing.com/chat?x=1",
    });
  });

  it("is null for anything that is not an http(s) URL", () => {
    for (const v of [null, undefined, "", "chatgpt.com", "android-app://com.google.android.gm", "javascript:alert(1)", "ftp://x.com", "https://", 5]) {
      expect(parseReferrer(v as string)).toBeNull();
    }
  });
});

describe("aiSourcePattern", () => {
  const re = new RegExp(aiSourcePattern(), "i");

  it("matches every AI source spelling", () => {
    for (const s of ["chatgpt.com", "chat.openai.com", "gemini.google.com", "perplexity.ai", "copilot.microsoft.com", "claude.ai", "meta.ai", "poe.com", "chat.deepseek.com", "grok.com", "x.ai", "chat.mistral.ai", "ChatGPT"]) {
      expect(re.test(s), s).toBe(true);
    }
  });

  it("does not match ordinary sources", () => {
    for (const s of ["google", "(direct)", "facebook", "instagram.com", "bing"]) {
      expect(re.test(s), s).toBe(false);
    }
  });
});
