"""Import both public FIU feeds; preserve the last good file if either source fails."""
import argparse
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
import hashlib
from html import unescape
from html.parser import HTMLParser
import json
import math
import os
from pathlib import Path
import re
import tempfile
import time
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent
NY = ZoneInfo("America/New_York")
UTC = timezone.utc
RSS_URL = "https://fiu.campuslabs.com/engage/events.rss"
CALENDAR_URL = "https://calendar.fiu.edu/api/2/events"
NS = {"ev": "events"}
ALIASES = {
    "GC": ["Graham Center", "Graham University Center"],
    "GL": ["Green Library", "Steven & Dorothea Green Library"],
    "PC": ["Charles Perry", "Charles E Perry", "Primera Casa"],
    "PBST": ["FIU Stadium", "Pitbull Stadium"],
    "OBCC": ["Ocean Bank Convocation Center", "Golden Panther Arena"],
    "FROST": ["Frost Art Museum"],
    "PCA": ["Paul Cejas Architecture Building", "Paul L Cejas School of Architecture"],
    "RDB": ["Rafael Diaz Balart Law Building", "Rafael Diaz Balart"],
    "WPAC": ["Wertheim Performing Arts Center"],
    "INV": ["Innovation 1", "Innovation Complex Building 1", "INV1"],
    "SIPA1": ["SIPA I", "SIPA 1"], "SIPA2": ["SIPA II", "SIPA 2"],
}


def normalized(value):
    return re.sub(r"[^a-z0-9]+", " ", unescape(value or "").lower().replace("&", " and ")).strip()


class PlainText(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts = []

    def handle_data(self, data):
        self.parts.append(data)


def plain_text(value):
    parser = PlainText()
    parser.feed(value or "")
    return " ".join(" ".join(parser.parts).split())


def safe_url(value):
    return value if value and urlparse(value).scheme in ("https", "http") else ""


def parse_time(value):
    if not value:
        return None
    try:
        result = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        result = parsedate_to_datetime(value)
    if result.tzinfo is None:
        result = result.replace(tzinfo=NY)
    return result.astimezone(UTC)


def iso(value):
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z") if value else None


def download(url):
    for attempt in range(3):
        try:
            request = Request(url, headers={"User-Agent": "FIUCampusMap/1.0", "Accept": "application/json, application/rss+xml, application/xml"})
            with urlopen(request, timeout=30) as response:
                return response.read().decode("utf-8-sig")
        except (OSError, TimeoutError):
            if attempt == 2:
                raise
            time.sleep(2 ** attempt)


def resolve_building(location, buildings):
    text = normalized(location)
    if re.search(r"\b(bbc|biscayne bay|fiu in dc|washington|doral|brickell|south beach|engineering center|zoom|online|virtual)\b", text) or safe_url(location):
        return None
    candidates = []
    for building in buildings:
        code = building["abbreviation"]
        names = [building["full_name"], *ALIASES.get(code, [])]
        matches = [len(normalized(name)) for name in names
                   if re.search(r"(?<!\w)" + re.escape(normalized(name)) + r"(?![a-z])", text)]
        # Match GC279A, but never PC inside PCA or AS inside ordinary lowercase prose.
        code_match = re.search(r"(?<![A-Za-z0-9])" + re.escape(code) + r"(?=$|[^A-Za-z]|\d)", location or "")
        if matches or code_match:
            candidates.append((max(matches, default=len(code)), building))
    if not candidates:
        return None
    candidates.sort(key=lambda item: item[0], reverse=True)
    if len(candidates) > 1 and candidates[0][0] == candidates[1][0]:
        return None
    return candidates[0][1]


def make_event(source, source_id, title, link, start, end, location, buildings,
               host="", description="", experience="inperson", geo=None, all_day=False,
               status="live", room="", categories=None):
    if str(status).lower() in {"cancelled", "canceled", "rejected", "deleted", "unpublished"}:
        return None
    if re.match(r"^\s*(cancelled|canceled)\b", title, re.I):
        return None
    if not title or not source_id or not start:
        raise ValueError(f"{source}: event missing title, ID or start time")
    start_dt, end_dt = parse_time(start), parse_time(end)
    if end_dt and end_dt < start_dt:
        raise ValueError(f"{source}: end precedes start for {source_id}")
    # Missing ends remain unknown in the UI; expire at the end of that local day.
    day_end = start_dt.astimezone(NY).date() + timedelta(days=1)
    expires = end_dt if end_dt and end_dt > start_dt else datetime.combine(day_end, datetime.min.time(), NY)
    if experience != "hybrid" and (re.search(r"\b(zoom|online|virtual)\b", location or "", re.I) or safe_url(location)):
        experience = "virtual"
    building = resolve_building(location, buildings) if experience != "virtual" else None
    # Published coordinates on another campus take precedence over an MMC abbreviation match.
    if building and geo:
        try:
            source_lat, source_lng = float(geo['latitude']), float(geo['longitude'])
            if math.isfinite(source_lat) and math.isfinite(source_lng) and (source_lat or source_lng) and not (25.745 <= source_lat <= 25.77 and -80.39 <= source_lng <= -80.36):
                building = None
        except (KeyError, TypeError, ValueError):
            pass
    if not room:
        match = re.search(r"\b(?:room|rm)\.?\s*([A-Za-z]?\d{2,4}[A-Za-z]?)\b", location or "", re.I)
        if not match and building:
            match = re.search(r"\b" + re.escape(building["abbreviation"]) + r"\s*[- ]?\s*(\d{2,4}[A-Za-z]?)\b", location or "")
        if match:
            room = match.group(1)
    lat = lng = None
    coordinate_source = None
    if building:
        lat, lng = building["latitude"], building["longitude"]
        coordinate_source = "MMC building inventory; approximate building location"
    elif experience != "virtual" and geo:
        try:
            lat, lng = float(geo["latitude"]), float(geo["longitude"])
            if not (math.isfinite(lat) and math.isfinite(lng) and -90 <= lat <= 90 and -180 <= lng <= 180) or (lat == 0 and lng == 0):
                lat = lng = None
            else:
                coordinate_source = "FIU Calendar published coordinates"
        except (KeyError, TypeError, ValueError):
            lat = lng = None
    link = safe_url(link)
    return {"id": f"{source}:{source_id}", "title": title.strip(), "link": link, "host": host,
            "location": location or "Location not published", "room": room or "",
            "start time": iso(start_dt), "end time": iso(end_dt), "expires_at": iso(expires),
            "all_day": bool(all_day), "experience": experience, "description": plain_text(description),
            "building_id": building["abbreviation"] if building else None,
            "latitude": lat, "longitude": lng, "coordinate_source": coordinate_source,
            "categories": categories or [], "sources": [{"name": source, "id": str(source_id), "url": link}]}


def parse_rss(xml, buildings):
    root = ET.fromstring(xml)
    if root.tag != "rss" or root.find("channel") is None:
        raise ValueError("Panther Connect returned something other than an RSS feed")
    events = []
    for item in root.findall("./channel/item"):
        def field(name):
            return item.findtext(name, default="", namespaces=NS)
        start = field("ev:start")
        identity = field("guid") or field("link")
        source_id = hashlib.sha256(f"{identity}|{start}".encode()).hexdigest()[:24] if identity else ""
        event = make_event("panther_connect", source_id, field("title"), field("link"), start,
                           field("ev:end"), field("ev:location"), buildings,
                           host=", ".join(n.text or "" for n in item.findall("ev:host", NS)),
                           description=field("description"), status=field("ev:status"),
                           categories=[n.text for n in item.findall("category") if n.text])
        if event:
            events.append(event)
    return events, root.findtext("./channel/description", default="Public Panther Connect RSS feed")


def fetch_calendar(start, days, buildings, fetch=download):
    events, seen_pages, page = [], set(), 1
    while True:
        payload = json.loads(fetch(CALENDAR_URL + "?" + urlencode({"start": start, "days": days,
                             "pp": 100, "page": page, "distinct": "false"})))
        if not isinstance(payload.get("events"), list) or not isinstance(payload.get("page"), dict):
            raise ValueError("FIU Calendar returned an invalid events page")
        meta = payload["page"]
        if meta.get("current") != page or page in seen_pages:
            raise ValueError("FIU Calendar pagination did not advance")
        seen_pages.add(page)
        for wrapper in payload["events"]:
            e = wrapper["event"]
            if e.get("private") or e.get("rejected") or e.get("publish_status", "published") != "published":
                continue
            instances = e.get("event_instances")
            if not isinstance(instances, list) or not instances:
                raise ValueError(f"FIU Calendar event {e.get('id')} has no occurrences")
            for occurrence in instances:
                instance = occurrence["event_instance"]
                event = make_event("fiu_calendar", str(instance["id"]), e["title"], e.get("localist_url"),
                    instance.get("start"), instance.get("end"), e.get("location_name") or e.get("location") or "",
                    buildings, host=", ".join(d["name"] for d in e.get("departments", [])),
                    description=e.get("description_text") or e.get("description", ""),
                    experience=e.get("experience") or "inperson", geo=e.get("geo"),
                    all_day=instance.get("all_day", False), status=e.get("status", "live"),
                    room=e.get("room_number"), categories=[f["name"] for f in e.get("filters", {}).get("event_types", [])])
                if event:
                    events.append(event)
        total = int(meta.get("total", 0))
        if total < page or total > 1000:
            raise ValueError("Unexpected FIU Calendar page count")
        if page >= total:
            break
        if meta.get("next_page") != page + 1:
            raise ValueError("FIU Calendar omitted a page")
        page += 1
    return events, len(seen_pages)


def deduplicate(events):
    result, by_id, cross_source = [], {}, {}
    for event in events:
        if event["id"] in by_id:
            continue
        venue = (event["building_id"], normalized(event["room"])) if event["building_id"] else (normalized(event["location"]), "")
        key = (normalized(event["title"]), event["start time"], event["end time"], event["experience"], venue)
        previous = cross_source.get(key)
        if previous and previous["sources"][0]["name"] != event["sources"][0]["name"]:
            previous["sources"].extend(event["sources"])
            by_id[event["id"]] = previous
            continue
        by_id[event["id"]] = event
        cross_source[key] = event
        result.append(event)
    return sorted(result, key=lambda e: (e["start time"], e["title"], e["id"]))


def build_feed(buildings, now=None, days=90, fetch=download):
    now = now or datetime.now(UTC)
    today = now.astimezone(NY).date()
    until = datetime.combine(today + timedelta(days=days), datetime.min.time(), NY)
    rss_events, coverage = parse_rss(fetch(RSS_URL), buildings)
    calendar_events, pages = fetch_calendar(str(today - timedelta(days=1)), days + 1, buildings, fetch)
    if not rss_events or not calendar_events:
        raise ValueError("A source returned no usable events; preserving previous data for review")
    events = deduplicate(calendar_events + rss_events)
    events = [e for e in events if parse_time(e["expires_at"]) > now and parse_time(e["start time"]) < until]
    return {"schema_version": 2, "generated_at": iso(now), "timezone": "America/New_York",
            "window": {"start": str(today), "end_exclusive": str(until.date())},
            "sources": [
                {"name": "panther_connect", "url": RSS_URL, "records": len(rss_events), "coverage": coverage},
                {"name": "fiu_calendar", "url": CALENDAR_URL, "records": len({e['id'] for e in calendar_events}),
                 "pages": pages, "coverage": f"Next {days} days, plus yesterday for ongoing events"}],
            "count": len(events), "events": events}


def atomic_write(path, payload):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    name = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, delete=False, suffix=".tmp") as f:
            name = f.name
            json.dump(payload, f, ensure_ascii=False, indent=2)
            f.write("\n")
            f.flush()
            os.fsync(f.fileno())
        os.replace(name, path)
    finally:
        if name and os.path.exists(name):
            os.unlink(name)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--days", type=int, default=90)
    parser.add_argument("--output", type=Path, default=ROOT / "events.json")
    args = parser.parse_args()
    if not 1 <= args.days <= 365:
        parser.error("--days must be between 1 and 365")
    buildings = json.loads((ROOT / "buildings.json").read_text(encoding="utf-8"))
    feed = build_feed(buildings, days=args.days)
    atomic_write(args.output, feed)
    mapped = sum(e["building_id"] is not None for e in feed["events"])
    print(f"Saved {feed['count']} upcoming occurrences; {mapped} matched to MMC buildings. {args.output}")


if __name__ == "__main__":
    main()
