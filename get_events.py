#This file will be used to parse the XML from Panther COnnect's RSS Feed
import requests
import xml.etree.ElementTree as ET
import json # Import the JSON module

rss_url = "https://fiu.campuslabs.com/engage/events.rss"
response = requests.get(rss_url)
#print(response.text)

root = ET.fromstring(response.text)

items = root.findall(".//item")
print(f"Number of events: {len(items)}\n")

index = 0
events_list = [] # will hold event dictionaries
NS = {'ev': 'events'}

for item in items:
    title    = item.findtext('title', default='')
    link     = item.findtext('link', default='')
    host       = item.findtext('ev:host', default='Unknown Host', namespaces=NS)
    location   = item.findtext('ev:location', default='Unknown Location', namespaces=NS)
    start_time = item.findtext('ev:start', default='', namespaces=NS)
    end_time   = item.findtext('ev:end', default='', namespaces=NS)

    print(f"Event: {title}\nLocation: {location}\n")

    events_data = {
        'title': title,
        'link': link,
        'host': host,
        'location': location,
        'start time': start_time,
        'end time': end_time
    }
    events_list.append(events_data)


# Save the list of dictionaries to a JSON file
with open('events.json', 'w') as f:
    json.dump(events_list, f, indent=4)

print(f"Successfully saved {len(events_list)} events to events.json")
