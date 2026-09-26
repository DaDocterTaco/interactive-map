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

for item in items:
    title = item.find("title").text
    location = item.find("{events}location").text

    print(f"Event: {title}\nLocation: {location}\n")
    events.append(item)
