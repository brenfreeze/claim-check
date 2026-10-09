# CheckitFirst demo: offline fact-check matching

**Pitch:** "Has this already been fact-checked?" The app answers on the phone, in airplane mode. It matches each claim against 2,600+ saved PH fact-checks from Rappler, VERA Files and AFP, using an on-device model (Decima ft3).

## Before the demo (online, once)

1. Install the latest dev build on the iPhone. Free-account signing lasts 7 days, so re-install if it's older.
2. Confirm the ft3 model is on the phone: **Settings → Developer → Phase 0 spike** should list the model files. If they're missing:
   - start `python3 -m http.server 8766 --bind 0.0.0.0 --directory models/finetune/ft3/onnx-int8` on the laptop;
   - set `EXPO_PUBLIC_MODEL_URL=http://<MAC_LAN_IP>:8766` in Metro;
   - tap Download.
3. Start Metro: `npx expo start --dev-client`. Open the app once, so the JS bundle loads and the corpus and model warm up.
4. Run each demo input once while online, to confirm the expected verdicts.

> **Debug-build caveat.** A Debug build loads its JS from Metro over the LAN. With airplane mode on, keep Metro reachable: turn Wi-Fi back on after enabling airplane mode, but leave the laptop's internet off if you want to show "no cloud". Or use **Settings → Developer → Simulate offline**. Everything the check itself does is on-device: Metro only serves the code. For a fully untethered run, build Release (embedded bundle) if time allows.

## The three inputs

Paste each one into Home, or open the deep link on the phone.

### 1. Recycled hoax (Taglish) → **Contradicted**

```
GRABE! WALANG PASOK sa buong bansa sa July 27 dahil sa SONA ni PBBM, sabi ng Malacañang! I-share niyo na!!
```

- Expected: **Contradicted**. The card shows **Rappler · Jul 27, 2026 · rated FALSE**: "No nationwide class suspension declared for Marcos' 5th SONA".
- Writing signals: All-caps urgency, Pressure to share.
- Laptop eval: p(supports) 0.98.
- Deep link: `claimcheck://?text=GRABE!%20WALANG%20PASOK%20sa%20buong%20bansa%20sa%20July%2027%20dahil%20sa%20SONA%20ni%20PBBM%2C%20sabi%20ng%20Malaca%C3%B1ang!%20I-share%20niyo%20na!!`

### 2. Misleading health claim → **Contradicted** (misleading pill)

```
Poul Thorsen's guilty plea proves that vaccines cause autism. Ingat sa bakuna!
```

- Expected: **Contradicted**. The card shows **AFP Fact Check · Sep 30, 2026 · rated MISLEADING**: "Danish researcher's guilty plea does not invalidate research on…".
- Laptop eval: p(supports) 1.00.
- Deep link: `claimcheck://?text=Poul%20Thorsen's%20guilty%20plea%20proves%20that%20vaccines%20cause%20autism.%20Ingat%20sa%20bakuna!`

### 3. Novel claim → **Unverified**

```
Libre na ang sakay sa MRT para sa lahat ng estudyante simula Lunes.
```

- Expected: **Unverified**, "No known fact-check".
  - Offline: the **Online enrichment** button is disabled and the claim shows **Queued for recheck**.
  - Back online: the queued check runs a live fact-check search.
- Laptop eval: best p(supports) 0.05, so no false match.
- Deep link: `claimcheck://?text=Libre%20na%20ang%20sakay%20sa%20MRT%20para%20sa%20lahat%20ng%20estudyante%20simula%20Lunes.`

### 4. Scan a screenshot (on-device OCR)

- On Home, tap **"Or try the demo screenshot →"**, or open Scan and tap **Use demo screenshot**. This reads `assets/demo/demo-screenshot.png` with Apple Vision on the phone.
- To show the real upload path, AirDrop that PNG to the phone, save it to Photos, then tap **Scan screenshot** and pick it.
- Expected detected sentences: the WALANG PASOK sentence and the MRT sentence are checked; "I-share niyo na…" and the page chrome are not.
- **Check 2 claims** → WALANG PASOK = **Contradicted** (Rappler); MRT = **Unverified**.

## Airplane-mode checklist

- [ ] Airplane mode **on**, or Settings → Developer → **Simulate offline** on.
- [ ] Force-quit the app, then cold start it.
- [ ] Home shows "Checked on-device against **N** saved fact-checks · synced <date>".
- [ ] Input 1 → Contradicted, Rappler card, rating pill FALSE.
- [ ] Input 2 → Contradicted, AFP card, rating pill MISLEADING.
- [ ] Input 3 → Unverified, "No known fact-check", enrichment shows **Queued for recheck**.
- [ ] Metro log shows **no** `[net-guard]` lines during the checks.
- [ ] Scan → Use demo screenshot → Check 2 claims, offline.
- [ ] Airplane mode **off** (or Simulate offline off): input 3's queued enrichment runs on its own and shows "Online check" results.

## Latency (fill in on the device)

| Input | Claims | Decisions | Match time per claim (Results → claim stats) | Total |
| --- | --- | --- | --- | --- |
| 1 Hoax | | | | |
| 2 Misleading | | | | |
| 3 Novel | | | | |

Laptop reference (onnxruntime-node, 2 threads): about 0.45–0.7 s per claim, 8 decisions each. The first check after a cold start also pays the model load, about 0.8 s on an iPhone 15 Pro.

## Known limits (say them if asked)

- **Negation.** "SSS pensioners will NOT get their 13th month…" still matched the original claim as the same claim (p 0.98). ft3 under-weights "not".
- **Some English paraphrases** read as "contradicts". "Super Typhoon Enteng is now Signal No. 4!!" got contradicts 0.95 against Rappler's "According to the latest weather report, Super Typhoon Enteng is now Signal No. 4". It then shows as Unverified with the related fact-check attached, which is the safe failure.
- **The corpus is a snapshot.** It was built from Google Fact Check Tools on the date shown in the app. Online enrichment covers newer fact-checks.
- **Almost no "true" ratings** (1 in the corpus). PH fact-checkers mostly publish debunks, so the app is a debunk finder, not a truth oracle.
