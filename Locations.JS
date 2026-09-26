/*File where all the primary markers + Base information will be included
    
Below is the template on how to create a marker and have information display:
    const marker = L.marker([25.7564631, -80.3727398]).addTo(map);
    marker.bindPopup("<b>Graham Center (GC)</b><br>");
*/

const buildings = [
    {
        name: "Graham Center",
        abbr: "GC",
        lat: 25.7564631,
        long: -80.3727398,
        desc: "" //will add later
    },
    {
        name: "Green Library",
        abbr: "GL"
    }
]