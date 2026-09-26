#This file will be used to parse the XML from Panther COnnect's RSS Feed
import requests
import xml.etree.ElementTree as ET

rss_url = "https://fiu.campuslabs.com/engage/events.rss"
response = requests.get(rss_url)
#print(response.text)

root = ET.fromstring(response.text)

items = root.findall(".//item")
print(f"Number of events: {len(items)}\n")

index = 0
events = []
NS = {'ev': 'events'}

for item in items:
    title    = item.findtext('title', default='')
    link     = item.findtext('link', default='')
    lhost       = item.findtext('ev:host', default='Unknown Host', namespaces=NS)
    location   = item.findtext('ev:location', default='Unknown Location', namespaces=NS)
    start_time = item.findtext('ev:start', default='', namespaces=NS)
    end_time   = item.findtext('ev:end', default='', namespaces=NS)

    print(f"Event: {title}\nLocation: {location}\n")
    events.append(item)
