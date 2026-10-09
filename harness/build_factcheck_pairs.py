"""ft3 step 2: mine claim/evidence pairs from the downloaded VERA Files fact-checks (mine_factcheck.py), apply the
contamination guard against fixtures/phase0.json, split by article, and write harness/data/factcheck/pairs.jsonl.

    uv run --group train python build_factcheck_pairs.py

Pairs (PRD framing; the model sees "Claim: …\nEvidence: …"):
- contradicts: claim = the viral post / quoted statement verbatim (first <blockquote>, claimSource "verbatim"), or the
  claim span the article states ("… claiming that X", "… nagsasabing X", claimSource "article"); evidence = 1–2
  consecutive fact sentences from the article's lead (after the claim sentence) or from the first refuting body
  paragraph.
- supports: claim = the article's headline with the "FACT CHECK:" prefix removed. VERA Files headlines state the
  verified correction ("Video … taken in Thailand, NOT in Davao Oriental", "WALANG ayudang …"), so the same refuting
  evidence supports it (claimSource "headline", i.e. a fact-checker paraphrase). Headlines that only rate a claim
  (MISLEADING, NEEDS CONTEXT, SATIRE, questions, round-ups) are skipped.
- unrelated: claim with evidence from a different article: "random" (no shared WP tag, low word overlap) and "hard"
  (shares a WP tag / topic word with the claim's article, but the evidence shares few content words with the claim).

Contamination guard: fixture source/claimFrom URLs are excluded, articles and pairs that hit the event blocklist are
dropped, and the script asserts that no fixture claim/evidence string or 8-word shingle appears in any pair.
fixtures/phase0.json is read ONLY to build that guard.
"""

from __future__ import annotations

import glob
import html
import json
import random
import re
from collections import Counter, defaultdict
from pathlib import Path

from bs4 import BeautifulSoup

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
RAW = HERE / "data" / "factcheck" / "raw"
OUT = HERE / "data" / "factcheck" / "pairs.jsonl"
STATS = ROOT / "models" / "finetune" / "ft3" / "pairs_stats.json"

# ---------------------------------------------------------------- contamination guard
# Event blocklist from the fixture claims (FT3-BRIEF.md). Each entry: (name, regex over lowercased text). Broad on purpose.
EVENTS = [
    ("remulla", r"remulla"),
    ("quake-forecast", r"(earthquake|lindol|quake).{0,80}(forecast|predict|prediction|map|risk|sept(ember)?\.? ?2[12])|"
                       r"(forecast|predict|prediction|map).{0,80}(earthquake|lindol|quake)|phivolcs.{0,60}predict"),
    ("bske", r"bske|barangay and (sk|sangguniang kabataan)|barangay at (sk|sangguniang kabataan)|barangay elections?|"
             r"sk elections?|certificates? of candidacy|filing of (coc|candidacy)|ra 12326|republic act 12326|"
             r"barangay (at|and) sk"),
    ("duterte-icc", r"\bicc\b|international criminal court|the hague|hague|interim release|"
                    r"duterte.{0,60}(release|makakauwi|makakalaya|nakalaya|laya|uuwi|umuwi|pauwi)"),
    ("zamboanga-fb-ban", r"zamboanga.{0,80}(shoot|shooting|pamamaril|binaril|gun)|ateneo de zamboanga|"
                         r"facebook ban|ban (on )?facebook|block(ing)? (of )?facebook|facebook.{0,40}(ban|blocked|ipagbabawal|bawal)"),
    ("marcos-resign", r"(marcos|bbm|pbbm|bongbong|pangulo).{0,80}(resign|pagbibitiw|bibitiw|magbitiw|nagbitiw)|"
                      r"(resign|pagbibitiw|bibitiw|magbitiw).{0,80}(marcos|bbm|pbbm|bongbong)"),
    ("ofw-150k", r"150[,.]?000|150k|₱150|p150|(ofw|owwa|dmw).{0,80}(ayuda|financial assistance|cash assistance|assistance)"),
    ("nationalid-ayuda", r"national id.{0,80}(ayuda|cash|assistance|subsidy|25k|25,000|5k|bonus)|"
                         r"(ayuda|cash|assistance|subsidy|25k|25,000).{0,80}national id|philsys.{0,60}(ayuda|cash|assistance)|"
                         r"25[,.]?000|25k|₱25|p25"),
    ("bato-senate", r"\bbato\b|dela rosa|justice committee|committee on justice"),
    ("senate-president", r"senate president|senate presidency|legarda|\bsotto\b|pangulo ng senado"),
]
EVENT_RE = [(n, re.compile(r, re.I | re.S)) for n, r in EVENTS]


def event_hit(text: str) -> str | None:
    t = text.lower()
    for n, r in EVENT_RE:
        if r.search(t):
            return n
    return None


def words(t: str) -> list[str]:
    return re.findall(r"\w+", t.lower())


def shingles(t: str, n: int = 8) -> set[str]:
    w = words(t)
    return {" ".join(w[i : i + n]) for i in range(len(w) - n + 1)}


def norm_url(u: str) -> str:
    u = u.lower().split("?")[0].rstrip("/")
    return re.sub(r"^https?://(www\.)?", "", u)


def fixture_guard() -> tuple[set[str], set[str], list[str]]:
    fx = json.loads((ROOT / "fixtures" / "phase0.json").read_text())["items"]
    urls = {norm_url(u) for it in fx for u in (it.get("source"), it.get("claimFrom")) if u}
    strings = [s for it in fx for s in (it["claim"], it["evidence"])]
    sh = set().union(*(shingles(s) for s in strings))
    return urls, sh, strings


# ---------------------------------------------------------------- text helpers
ABBR = r"(?:Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec|Sen|Rep|Gov|Fr|Dr|Atty|Gen|Lt|Col|Brig|Maj|Capt|Sgt|Mr|Mrs|Ms|" \
       r"Ene|Peb|Abr|Hun|Hul|Ago|Set|Okt|Nob|Dis|St|No|Nos|Vol|Pres|VP|Sec|Usec|Asec|Cong|Engr|Hon|Jr|Sr|Inc|Corp|Co|vs|Mt|Ave|Brgy|Gng|G|Bb|Dra|Prof|U\.S|P|Pp|[A-Z])"


def protect(p: str) -> str:
    return re.sub(rf"\b({ABBR})\.", r"\1<DOT>", p)


def sentences(p: str) -> list[str]:
    p = protect(p)
    parts = re.split(r"(?<=[.!?])[”\"’)]?\s+(?=[A-Z“\"‘(ÑÁ0-9₱])", p)
    out = []
    for s in parts:
        s = s.replace("<DOT>", ".").strip()
        if s:
            out.append(s)
    return out


TL_WORDS = set("ang ng mga sa na ay si ni hindi ito siya para kung pa ba naman yung nang din rin lang walang may kay kaya po "
               "nila niya natin ako ka mo ko kami tayo sila ating aming niyang ayon dahil pero ngunit mula noong upang "
               "nasabing ibang isang ganito kanilang kanyang ngayong lamang".split())


def lang_of(t: str) -> str:
    w = words(t)
    if not w:
        return "en"
    r = sum(x in TL_WORDS for x in w) / len(w)
    return "tl" if r >= 0.12 else ("mixed" if r >= 0.05 else "en")


CLAIM_DESC = re.compile(r"\b(claim|claims|claimed|claiming|circulat|kumakalat|nagsasabing|sinasabing|viral|post|posted|"
                        r"shared|ini-upload|in-upload|netizen|facebook user|fb user|tiktok|youtube|users?|caption|"
                        r"nag-post|ibinahagi|pinagmumukha|umano|diumano|supposedly|allegedly|purported)", re.I)
VERDICT = re.compile(r"(not true|false|fake|misleading|hoax|baseless|no basis|hindi totoo|peke|mali|walang katotohanan|"
                     r"walang basehan|needs context|kailangan ng konteksto|nangangailangan ng konteksto|mapanlinlang)", re.I)
REFUTE = re.compile(r"(not true|no record|did not|does not|do not|has not|have not|had not|was not|were not|is not|are not|"
                    r"there is no|there are no|no such|never|contrary|in fact|actually|reverse image|keyword search|"
                    r"taken (in|from|during)|old (photo|video|clip|image)|edited|manipulated|altered|doctored|digitally|"
                    r"ai-generated|artificial intelligence|walang|hindi|luma|peke|pinasinungalingan|taliwas|itinanggi|"
                    r"denied|debunk|clarified|nilinaw|official)", re.I)
STATS_RE = re.compile(r"(reactions|shares|views|comments|followers|garnered|nakakuha|umani|engagement|created on|"
                      r"ginawa noong|page was created|account was created)", re.I)
BAD_TITLE = re.compile(r"(misleading|mapanlinlang|needs context|konteksto|satire|\?|mali-ta minute|fact sheet|round-?up|"
                       r"\bclaims?\b|pahayag|sinabi|flip-?flop|exaggerat|lacks|kulang|walang basehan|baseless|unproven)", re.I)


DEBUNK_TITLE = re.compile(r"\b(NOT|NO|FAKE|FALSE|HINDI|WALANG|WALA|PEKE|HOAX|AI|AI-GENERATED|GAWANG-AI|EDITED|ALTERED|OLD|LUMA|"
                          r"never|scam|hindi totoo|walang basehan|baseless|manipulated|doctored|passed off|ipinasa)\b")


def ok_sent(x: str) -> bool:
    return not x.rstrip().endswith(":") and not re.match(r"^[“\"‘]", x) and not re.match(r"^[0-9]{1,2}, |^[a-z]", x) and "<DOT>" not in x


def clean(t: str) -> str:
    t = html.unescape(t).replace("\xa0", " ")
    t = re.sub(r"\s+", " ", t).strip()
    t = re.sub(r"\s+([,.;:!?])", r"\1", t)
    return t


def headline_claim(title: str) -> str | None:
    t = clean(BeautifulSoup(title, "lxml").get_text())
    if BAD_TITLE.search(t) or not re.match(r"^(VERA FILES )?FACT CHECK:", t, re.I):
        return None
    t = re.sub(r"^(VERA FILES )?FACT CHECK:\s*", "", t, flags=re.I)
    # de-shout emphasis words but keep acronyms that are acronyms everywhere (DSWD, PSA, …)
    t = re.sub(r"\b(NOT|NO|FAKE|FALSE|HINDI|WALANG|WALA|PEKE|HOAX|AI|GAWANG-AI|TOTOO|ALTERED|EDITED|OLD|LUMA|NEVER|DID|DOES)\b",
               lambda m: m.group(1) if m.group(1) == "AI" else m.group(1).lower(), t)
    t = t[0].upper() + t[1:] if t else t
    if len(words(t)) < 5:
        return None
    return t.rstrip(".") + "."


def article(p: dict) -> dict | None:
    s = BeautifulSoup(p["content"]["rendered"], "lxml")
    blocks = []  # (kind, text)
    bq_texts = set()
    for e in s.find_all(["p", "blockquote", "h2", "h3"]):
        if e.name == "p" and e.find_parent("blockquote"):
            continue
        t = clean(e.get_text(" ", strip=True))
        if not t:
            continue
        if e.name == "blockquote":
            bq_texts.add(t.strip("“”\" "))
        blocks.append((e.name, t))
    # drop paragraphs that just repeat a blockquote, and image credits / editor notes
    blocks = [(k, t) for k, t in blocks if not (k == "p" and t.strip("“”\" ") in bq_texts)
              and not re.match(r"^(\(|Editor|Correction|Update|Photo|Screenshot|Larawan|\[|Have you seen)", t, re.I)]
    return {"id": p["id"], "url": p["link"], "date": p["date"][:10], "title": clean(BeautifulSoup(p["title"]["rendered"], "lxml").get_text()),
            "headline": headline_claim(p["title"]["rendered"]), "tags": p.get("tags", []), "blocks": blocks}


CLAIM_SPAN = re.compile(r"(?:claim(?:s|ed|ing)?|saying|stating|alleging|nagsasabing|sinasabing|na nagsasabing) (?:that )?(.{25,260}?)[.](?:\s|$)", re.I)


def mine(a: dict) -> dict:
    """claims (verbatim / article span) and refuting evidences for one article."""
    blocks = a["blocks"]
    first_bq = next((i for i, (k, _) in enumerate(blocks) if k == "blockquote"), None)
    claims = []
    if first_bq is not None:
        q = re.split(r"\b(Pinagmulan|Source|Pinanggalingan)\s*:", blocks[first_bq][1])[0].strip("“”\" ")
        ss = sentences(q)
        q2 = ""
        for x in ss:  # keep the first sentences up to ~45 words
            if len(words(q2 + " " + x)) > 45 and q2:
                break
            q2 = (q2 + " " + x).strip()
        if 4 <= len(words(q2)) <= 50 and DEBUNK_TITLE.search(a["title"]):
            claims.append({"text": q2, "claimSource": "verbatim"})
    lead_end = first_bq if first_bq is not None else min(3, len(blocks))
    lead = [t for k, t in blocks[:lead_end][:3] if k == "p"]
    lead_sents = [x for t in lead for x in sentences(t)]
    for x in lead_sents[:3]:
        m = CLAIM_SPAN.search(protect(x))
        if m:
            c = m.group(1).replace("<DOT>", ".").strip(" “”\"'‘’,")
            if 5 <= len(words(c)) <= 40 and not VERDICT.search(c) and DEBUNK_TITLE.search(a["title"]):
                claims.append({"text": c[0].upper() + c[1:] + ".", "claimSource": "article"})
            break
    evid = []
    # (1) lead: fact sentences after the claim-describing / verdict sentences
    facts = [x for x in lead_sents if ok_sent(x) and not CLAIM_DESC.search(x) and not STATS_RE.search(x)
             and not (VERDICT.search(x) and len(words(x)) <= 9) and 6 <= len(words(x)) <= 60]
    if facts:
        e = facts[0]
        i = lead_sents.index(e)
        if i + 1 < len(lead_sents) and lead_sents[i + 1] in facts and len(words(e + lead_sents[i + 1])) <= 60:
            e = e + " " + lead_sents[i + 1]
        evid.append({"text": e, "where": "lead"})
    # (2) first refuting body paragraph after the claim quote
    start = (first_bq + 1) if first_bq is not None else lead_end
    for k, t in blocks[start:]:
        if k != "p" or STATS_RE.search(t):
            continue
        ss = [x for x in sentences(t) if 6 <= len(words(x)) <= 55 and ok_sent(x) and not CLAIM_DESC.search(x)]
        if ss and REFUTE.search(ss[0]):
            e = ss[0] + (" " + ss[1] if len(ss) > 1 and len(words(ss[0] + ss[1])) <= 60 else "")
            if all(e != v["text"] for v in evid):
                evid.append({"text": e, "where": "body"})
            break
    return {"claims": claims, "evidence": evid}


def content_words(t: str) -> set[str]:
    return {w for w in words(t) if len(w) > 3 and w not in TL_WORDS and not w.isdigit()} - STOP


STOP = set("that this with from have been were their they there which what when where will would could should about after "
           "before also said says into over only than then them these those such some more most other being does didn "
           "isn hasn wasn aren fact check post posts video photo facebook user users claim claims false fake true".split())


def main() -> None:
    urls_blocked, fx_sh, fx_strings = fixture_guard()
    posts = {}
    for f in sorted(glob.glob(str(RAW / "*.json"))):
        for p in json.loads(Path(f).read_text()):
            posts.setdefault(p["id"], p)
    arts = [article(p) for p in posts.values()]
    st = Counter()
    st["articles_downloaded"] = len(arts)
    kept = []
    for a in arts:
        if norm_url(a["url"]) in urls_blocked:
            st["articles_dropped_fixture_url"] += 1
            continue
        lead_text = a["title"] + " " + " ".join(t for _, t in a["blocks"][:4])
        if event_hit(lead_text):
            st["articles_dropped_event"] += 1
            st[f"event:{event_hit(lead_text)}"] += 1
            continue
        a.update(mine(a))
        if not a["evidence"]:
            st["articles_no_evidence"] += 1
            continue
        kept.append(a)
    st["articles_usable"] = len(kept)

    rng = random.Random(3)
    rng.shuffle(kept)
    n_dev = round(0.2 * len(kept))
    for i, a in enumerate(kept):
        a["split"] = "dev" if i < n_dev else "train"

    pairs = []

    def add(a, claim, csrc, ev, label, kind, ev_url=None):
        pairs.append({"claim": claim, "evidence": ev, "label": label, "claimSource": csrc, "kind": kind, "split": a["split"],
                      "article": a["id"], "source": a["url"], "evidenceFrom": ev_url or a["url"],
                      "claimLang": lang_of(claim), "evidenceLang": lang_of(ev)})

    for a in kept:
        for c in a["claims"]:
            for e in a["evidence"]:
                add(a, c["text"], c["claimSource"], e["text"], "contradicts", f"refute-{e['where']}")
        if a["headline"]:
            for e in a["evidence"]:
                add(a, a["headline"], "headline", e["text"], "supports", f"headline-{e['where']}")

    # unrelated: evidence from another article in the same split
    by_split = defaultdict(list)
    for a in kept:
        by_split[a["split"]].append(a)
    for split, group in by_split.items():
        tag_idx = defaultdict(list)
        for a in group:
            for t in a["tags"]:
                tag_idx[t].append(a)
        for a in group:
            cl = [c["text"] for c in a["claims"]] + ([a["headline"]] if a["headline"] else [])
            if not cl:
                continue
            aw = content_words(a["title"])
            for kind in ("hard", "random"):
                if kind == "hard":
                    cands = {b["id"]: b for t in a["tags"] for b in tag_idx[t] if b["id"] != a["id"]}
                    cands = list(cands.values())
                else:
                    cands = [b for b in group if b["id"] != a["id"] and not set(b["tags"]) & set(a["tags"])]
                rng.shuffle(cands)
                for b in cands[:30]:
                    bw = content_words(b["title"])
                    if aw and len(aw & bw) / len(aw | bw) > 0.25:
                        continue  # likely the same story told twice
                    c = rng.choice(cl)
                    e = rng.choice(b["evidence"])["text"]
                    cw = content_words(c)
                    if cw and len(cw & content_words(e)) / len(cw) > 0.2:
                        continue
                    add(a, c, next((x["claimSource"] for x in a["claims"] if x["text"] == c), "headline"), e, "unrelated",
                        f"unrelated-{kind}", b["url"])
                    break

    # pair-level guard: event keywords in claim or evidence, then fixture strings / 8-word shingles
    out = []
    for p in pairs:
        if event_hit(p["claim"]) or event_hit(p["evidence"]):
            st["pairs_dropped_event"] += 1
            continue
        txt = p["claim"] + " \n " + p["evidence"]
        if any(s.lower() in txt.lower() for s in fx_strings) or (shingles(p["claim"]) | shingles(p["evidence"])) & fx_sh:
            st["pairs_dropped_shingle"] += 1
            continue
        out.append(p)
    # dedupe
    seen, final = set(), []
    for p in out:
        k = (p["claim"], p["evidence"])
        if k not in seen:
            seen.add(k)
            final.append(p)
    # hard assertion: nothing of the fixtures survives
    for p in final:
        assert not (shingles(p["claim"]) | shingles(p["evidence"])) & fx_sh, p
        assert not any(s.lower() in (p["claim"] + p["evidence"]).lower() for s in fx_strings), p
        assert norm_url(p["source"]) not in urls_blocked and norm_url(p["evidenceFrom"]) not in urls_blocked, p

    OUT.write_text("\n".join(json.dumps(p, ensure_ascii=False) for p in final) + "\n")
    nonen = lambda p: p["claimLang"] != "en" or p["evidenceLang"] != "en"
    summary = {"guard": dict(st), "pairs": len(final),
               "bySplit": Counter(p["split"] for p in final), "byLabel": Counter(p["label"] for p in final),
               "byKind": Counter(p["kind"] for p in final), "byClaimSource": Counter(p["claimSource"] for p in final),
               "nonEnglishShare": sum(map(nonen, final)) / len(final),
               "byLang": Counter(f"{p['claimLang']}/{p['evidenceLang']}" for p in final),
               "articlesBySplit": Counter(a["split"] for a in kept),
               "labelBySplit": Counter(f"{p['split']}:{p['label']}" for p in final)}
    STATS.write_text(json.dumps(summary, indent=1, default=dict))
    print(json.dumps(summary, indent=1, default=dict))


if __name__ == "__main__":
    main()
