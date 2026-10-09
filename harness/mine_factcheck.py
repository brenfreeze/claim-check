"""ft3 step 1: download VERA Files fact-check posts (English + Filipino sections) for local pair mining.

    uv run --group train python mine_factcheck.py --pages-en 4 --pages-fil 4

Rules followed (FT3-BRIEF.md):
- robots.txt checked on 2026-10-09: verafiles.org serves none (404), pages carry "index, follow".
  rappler.com is NOT mined: its robots.txt disallows anthropic-ai, ClaudeBot, Claude-User, Claude-Web, GPTBot,
  CCBot, Google-Extended and other AI agents, i.e. it opts out of AI use. AFP Fact Check's robots.txt returns 403
  (bot wall), so it is skipped too.
- One request at a time, >= 1.1 s apart, descriptive User-Agent, no login, public WordPress REST endpoint
  (/wp-json/wp/v2/posts, 100 posts per request, so a few requests total instead of hundreds of page loads).
- Output stays under harness/data/factcheck/ (git-ignored). Each post keeps its source URL.
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import httpx

OUT = Path(__file__).resolve().parent / "data" / "factcheck" / "raw"
UA = "claim-check-research/0.1 (non-commercial fact-check model research; contact brenfreeze@gmail.com)"
API = "https://verafiles.org/wp-json/wp/v2/posts"
CATS = {"en": 2035, "fil": 2617}  # FACT CHECK, fact-check-filipino (from /wp-json/wp/v2/categories)
DELAY = 1.1


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pages-en", type=int, default=4)
    ap.add_argument("--pages-fil", type=int, default=4)
    args = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    last = 0.0
    with httpx.Client(headers={"User-Agent": UA}, timeout=60, follow_redirects=True) as c:
        for sec, pages in (("fil", args.pages_fil), ("en", args.pages_en)):
            for page in range(1, pages + 1):
                f = OUT / f"verafiles_{sec}_p{page}.json"
                if f.exists():
                    continue
                time.sleep(max(0.0, DELAY - (time.time() - last)))
                last = time.time()
                r = c.get(API, params={"categories": CATS[sec], "per_page": 100, "page": page,
                                       "_fields": "id,date,link,title,content,categories,tags"})
                print(sec, page, r.status_code, len(r.content), flush=True)
                if r.status_code != 200:
                    break
                f.write_text(r.text)


if __name__ == "__main__":
    main()
