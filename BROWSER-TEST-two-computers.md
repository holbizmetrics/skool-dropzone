# Operator test — two computers (v0.8.6)

**Who:** you (the operator). **Needs:** a second computer. Test C also needs a second Skool account.
**Why:** everything so far ran on ONE computer. On 2026-11-20 "Connect by code" worked between two
tabs on your PC ("1 peer connected", chat both ways). What is not proven yet is the real case: two
different computers, and two different networks.

Tick each box. If something fails, write down the **exact wording** of the message in the panel.

---

## Preparation (once per computer)

- [ ] Get the extension on the second computer: repo `holbizmetrics/skool-dropzone`, branch
      **`feat/hosted-relay`** (not master). Either `git clone -b feat/hosted-relay https://github.com/holbizmetrics/skool-dropzone.git`
      or on GitHub switch to that branch → Code → Download ZIP.
- [ ] `brave://extensions` (or `chrome://extensions`) → Developer mode ON → **Load unpacked** →
      pick the **`extension`** folder inside the repo (not the repo itself).
- [ ] Both computers: open the same Skool meeting link, click **JOIN CALL**.
- [ ] Both panels show **v0.8.6** in the header.

---

## Test A — Connect by code, same network (both computers on your home Wi-Fi/LAN)

Works with the same Skool account on both computers.

- [ ] Both: type the same passphrase (e.g. `test123`). Do **not** click Join room.
- [ ] Both: open **"Connect by code — two computers, no server"**.
- [ ] Computer 1: **Create my code** → **Copy my code** → get it to computer 2 (Skool chat, e-mail to yourself, anything).
- [ ] Computer 2: paste into the lower box → **Use code** → **Copy my code** → get the reply back to computer 1.
- [ ] Computer 1: paste the reply → **Use code**.
- [ ] Both show **"🔒 end-to-end encrypted · 1 peer connected"**.
- [ ] Chat: a message from computer 1 arrives on computer 2, and back.
- [ ] Bonus: send a small file (＋ next to the message box) and check it arrives.
- [ ] Bonus: room safe-word (the 5 emoji) is the SAME on both.

**Result A:** ☐ passed ☐ failed — message: ______________________

---

## Test B — Connect by code, different networks (phone hotspot)

Same steps as A, but computer 2 is on your **phone's hotspot** instead of the home network.

- [ ] Computer 2 on the phone hotspot (home Wi-Fi off on that computer).
- [ ] Steps of Test A repeated.
- [ ] Connected? ☐ yes ☐ no — if no: did **"No direct connection after 20 seconds…"** appear?

**Result B:** ☐ passed ☐ failed — message: ______________________

*If B fails with the 20-second message, that is not a bug in the code: some mobile networks block
direct links. It would mean we need a relay (TURN) for that kind of network. Tell me, and we decide.*

---

## Test C — Automatic connecting (needs TWO DIFFERENT Skool accounts)

The same account twice does NOT work for this: Skool keeps one call connection per account and both
would have the same id. Log into the second Skool account on computer 2.

- [ ] Computer 2 logged into the **other** Skool account, both in the same call.
- [ ] Both: type the same passphrase → click **Join room** (this time yes).
- [ ] Both show **"🔒 Joined. Looking for other members with the same passphrase in this call…"**.
      (If one says **"Skool's call channel was not found…"**: write it down, stop here.)
- [ ] Within ~10 seconds, without any copy-paste: both switch to **"1 peer connected"**.
- [ ] Chat works both ways.
- [ ] Negative check: on computer 2 press **Ctrl+F5**, JOIN CALL again, type a DIFFERENT passphrase,
      **Join room** → it must **NOT** connect (and its safe-word emoji differ from computer 1's).

**Result C:** ☐ passed ☐ failed — message: ______________________

---

## Test D — in any real call, even if only you run skool-dropzone

Nobody else in the call sees any of this.

- [ ] Type a passphrase (e.g. `test123`) → **Join room** → shows **"🔒 Joined. Looking for other members…"**
      and no error. (Proves Skool's call channel is found and accepts our messages in a full call.
      Our messages use our own topic "sdz", which Skool's app ignores.) If an error appears: write it down.
- [ ] **💾 Archive** → an HTML file of the meeting is saved on your computer and opens.
- [ ] Look: the panel covers the right column of tiles. OK as it is, or should the panel push the
      video aside instead? (Quick fixes today: the grip makes it narrower, ⇄ moves it to the other side.)

**Result D:** ☐ passed ☐ failed — message: ______________________

Already passed 2026-11-23 (real call, 7 people, v0.8.7): **👥 Names** copied all 7 names from
Skool's call data, including one person with no visible tile.

---

## Also look at, while two people are in the call

- [ ] **👥 Names**: does it list both names?
- [ ] Skool's own **Participants** list open: does Names still work?

When done, tell the agent the results (a photo of this sheet or the ticks in chat is enough).
