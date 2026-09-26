# Public FIU events on the campus map

`get_events.py` fetches Panther Connect RSS and FIU Calendar's public Localist API, then atomically replaces `events.json`. `Locations.JS` starts `events-map.mjs`, which reads that file and `buildings.json`. A database service and API credentials are not required.

## Run locally

Use Python 3.10+ and Node 18+ for the tests. On Windows install the timezone database once:

```sh
python -m pip install -r requirements-events.txt
python get_events.py
python -m http.server 8031 --bind 127.0.0.1
```

Open http://127.0.0.1:8031/index.html. Run `python get_events.py` whenever you want to download fresh source data; `--days 90` is the default. The script resolves its data paths relative to itself, so running from another directory is safe.

## What changed

- Both sources are imported. FIU Calendar is paginated through a rolling 90-day window, plus yesterday to include ongoing occurrences returned by the API. Panther Connect currently exposes about 30 days through its RSS feed; its actual coverage description is saved in the feed. Neither source guarantees every university event.
- Every occurrence has an ID and source links. Repeated API records are deduplicated by occurrence ID; conservative cross-source matches require matching normalized title, start, end, experience and building/room or location. Separate recurring dates remain separate. Similar titles, uncertain rooms and different times can remain duplicates intentionally.
- Cancelled and expired events are excluded. Missing end times are labeled honestly and expire at the end of their local start date. An event changed or removed upstream disappears on the next successful full refresh. If a source fails, previous data stays until a later successful refresh.
- Explicit venue aliases fix names such as Graham Center and Green Library. Codes support room forms such as GC279A. BBC, Washington/DC and virtual locations are not assigned to MMC buildings. Explicit published coordinates outside the MMC map override abbreviation matches. Coordinates describe approximate buildings, not verified entrances or rooms.
- The map offers search, Today / Next 7 days / All upcoming, source filters, building counts, event links and Show on map. Online, other-campus and unlocated events stay in the list.
- The browser checks the saved feed every five minutes and on tab return; it hides expired events every minute. These checks do **not** run Python or re-fetch upstream sources. A last-updated timestamp and a warning after 36 hours expose stale data. Failed browser refreshes keep loaded events and building markers available.
- Feed text is rendered with DOM text nodes. Only HTTP(S) event links become clickable.

## Daily scheduling and publishing

For this local installation, the Codex app automation **Refresh local FIU events** is active at **5:17 AM America/New_York daily**. It runs this folder's importer and verifies the feed. Keep the computer on, the app running, and internet access available. It changes only the local event data and does not commit, push, or deploy. Other copies of the map do not update automatically. The automation is an app setting tied to this chat, not something installed by cloning the repository.

The GitHub workflow below is a prepared alternative for when the team publishes the map; it is not needed by the active local automation.

`.github/workflows/refresh-events.yml` tests the importer, fetches both sources, commits only `events.json` and uploads a feed artifact. It requests 09:17 UTC daily (5:17 AM EDT / 4:17 AM EST). GitHub can delay scheduled runs. It also supports a manual Actions run.

**A workflow on a feature branch is not an active daily schedule.** GitHub requires the scheduled workflow to exist on the repository's default branch. This repository currently defaults to `main`, while the working map is on `livechat`. The implementation must be merged and a default-branch scheduling workflow must be enabled against the branch that owns the map before unattended refresh is active. Do not merge unrelated application branches solely to activate a timer.

The workflow needs Actions enabled and permission to push the data update to its target branch. Branch protection can prevent direct commits; configure an allowed data branch or review flow if protection is enabled. No personal token is embedded in the code. GitHub may disable scheduled workflows on inactive public repositories.

A Git commit updates the repository, not necessarily a hosted website. The hosting service must publish the refreshed data. Commits made with `GITHUB_TOKEN` generally do not trigger another Actions workflow; an Actions-based site deployment must run in the same workflow or use an explicit supported downstream trigger. Hosting has not been assumed or enabled by this change. Local copies need `git pull` or their own run of the importer.

## Data contract

`events.json` is now a version 2 object with `generated_at`, `timezone`, `window`, `sources`, `count` and `events`. Each event retains `title`, `link`, `host`, `location`, `start time`, `end time` and adds identity, coordinates, building ID, room, source references and expiry. Dates are ISO 8601 UTC; display uses America/New_York with daylight-saving rules. Deploy the new feed and map code together: old consumers expecting a top-level array must switch to `feed.events`.

`buildings.json` contains the existing map's building locations, extracted without changing coordinates. Maintain that one file for both the importer and map. Alias definitions are in `get_events.py`; unknown locations are never replaced by the generic campus address.

## Validation

```sh
python -m unittest discover -s tests -p test_events.py
node --test tests/event-utils.test.mjs
```

Tests cover pagination, namespace parsing, recurring dates, cross-source duplicate references, distinct rooms, cancellations, coordinate validation, virtual/off-campus exclusions, daylight-saving times, unknown ends, failed-refresh preservation, atomic writes, filters, unsafe URLs and malformed feeds. Browser review covers actual imported events, search, filters and building popups.
