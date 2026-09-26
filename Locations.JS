/*File where all the primary markers + Base information will be included
    
Below is the template on how to create a marker and have information display:
    const marker = L.marker([25.7564631, -80.3727398]).addTo(map);
    marker.bindPopup("<b>Graham Center (GC)</b><br>");
*/

const buildings = [
    {
      "abbreviation": "ACC",
      "full_name": "Ambulatory Care Center",
      "latitude": 25.760796,
      "longitude": -80.371659,
      "description": ""
    },
    {
      "abbreviation": "AHC1",
      "full_name": "Academic Health Center 1",
      "latitude": 25.757634,
      "longitude": -80.371388,
      "description": ""
    },
    {
      "abbreviation": "AHC2",
      "full_name": "Academic Health Center 2",
      "latitude": 25.758117,
      "longitude": -80.371285,
      "description": ""
    },
    {
      "abbreviation": "AHC3",
      "full_name": "Academic Health Center 3",
      "latitude": 25.758772,
      "longitude": -80.371389,
      "description": ""
    },
    {
      "abbreviation": "AHC4",
      "full_name": "Academic Health Center 4",
      "latitude": 25.759281,
      "longitude": -80.37224,
      "description": ""
    },
    {
      "abbreviation": "AHC5",
      "full_name": "Academic Health Center 5",
      "latitude": 25.75923,
      "longitude": -80.371171,
      "description": ""
    },
    {
      "abbreviation": "AS",
      "full_name": "Digital Art Studio",
      "latitude": 25.753013,
      "longitude": -80.381278,
      "description": ""
    },
    {
      "abbreviation": "ASTRO",
      "full_name": "Stocker Astroscience Center",
      "latitude": 25.757901,
      "longitude": -80.372544,
      "description": ""
    },
    {
      "abbreviation": "BBS",
      "full_name": "FIU Baseball Stadium",
      "latitude": 25.754093,
      "longitude": -80.381312,
      "description": ""
    },
    {
      "abbreviation": "BS",
      "full_name": "Bike Shop",
      "latitude": 25.75837,
      "longitude": -80.38067,
      "description": ""
    },
    {
      "abbreviation": "BT",
      "full_name": "Building Ten",
      "latitude": 25.758372,
      "longitude": -80.375532,
      "description": ""
    },
    {
      "abbreviation": "CASE",
      "full_name": "Computing, Arts, Sciences and Education",
      "latitude": 25.758968,
      "longitude": -80.373872,
      "description": ""
    },
    {
      "abbreviation": "CBC",
      "full_name": "College of Business Complex",
      "latitude": 25.757799,
      "longitude": -80.377147,
      "description": ""
    },
    {
      "abbreviation": "CCLC",
      "full_name": "Children’s Creative Learning Center",
      "latitude": 25.756774,
      "longitude": -80.381991,
      "description": ""
    },
    {
      "abbreviation": "CFES",
      "full_name": "Carlos Finlay Elementary School",
      "latitude": 25.759572,
      "longitude": -80.381337,
      "description": ""
    },
    {
      "abbreviation": "CP",
      "full_name": "Chemistry & Physics",
      "latitude": 25.7584,
      "longitude": -80.372232,
      "description": ""
    },
    {
      "abbreviation": "CSC",
      "full_name": "Campus Support Complex",
      "latitude": 25.75439,
      "longitude": -80.3822,
      "description": ""
    },
    {
      "abbreviation": "DC",
      "full_name": "Duplicating Center",
      "latitude": 25.755871,
      "longitude": -80.376028,
      "description": ""
    },
    {
      "abbreviation": "DM",
      "full_name": "Deuxieme Maison",
      "latitude": 25.756151,
      "longitude": -80.374682,
      "description": ""
    },
    {
      "abbreviation": "EH",
      "full_name": "Everglades Hall",
      "latitude": 25.753765,
      "longitude": -80.375369,
      "description": ""
    },
    {
      "abbreviation": "FROST",
      "full_name": "Patricia and Phillip Frost Art Museum",
      "latitude": 25.753723,
      "longitude": -80.37314,
      "description": ""
    },
    {
      "abbreviation": "FSB",
      "full_name": "Field Support Building",
      "latitude": 25.755405,
      "longitude": -80.378801,
      "description": ""
    },
    {
      "abbreviation": "GC",
      "full_name": "Ernest R. Graham Center",
      "latitude": 25.756263,
      "longitude": -80.372708,
      "description": ""
    },
    {
      "abbreviation": "INV",
      "full_name": "Innovation Complex (Building 1)",
      "latitude": 25.760607,
      "longitude": -80.369313,
      "description": ""
    },
    {
      "abbreviation": "GL",
      "full_name": "Steven and Dorothea Green Library",
      "latitude": 25.757165,
      "longitude": -80.373853,
      "description": ""
    },
    {
      "abbreviation": "LC",
      "full_name": "Labor Center",
      "latitude": 25.756531,
      "longitude": -80.377137,
      "description": ""
    },
    {
      "abbreviation": "LVN",
      "full_name": "Lakeview Hall North",
      "latitude": 25.754431,
      "longitude": -80.374653,
      "description": ""
    },
    {
      "abbreviation": "LVS",
      "full_name": "Lakeview Hall South",
      "latitude": 25.753949,
      "longitude": -80.374466,
      "description": ""
    },
    {
      "abbreviation": "MANGO",
      "full_name": "Management and New Growth Opportunities Building",
      "latitude": 25.757392,
      "longitude": -80.376949,
      "description": ""
    },
    {
      "abbreviation": "MARC",
      "full_name": "Management and Advanced Research Center",
      "latitude": 25.754613,
      "longitude": -80.373562,
      "description": ""
    },
    {
      "abbreviation": "NOAA",
      "full_name": "National Hurricane Center",
      "latitude": 25.754468,
      "longitude": -80.383627,
      "description": ""
    },
    {
      "abbreviation": "OBCC",
      "full_name": "Ocean Bank Convocation Center",
      "latitude": 25.756936,
      "longitude": -80.379744,
      "description": ""
    },
    {
      "abbreviation": "OE",
      "full_name": "Owa Ehan",
      "latitude": 25.758251,
      "longitude": -80.372664,
      "description": ""
    },
    {
      "abbreviation": "PBST",
      "full_name": "Pitbull Stadium",
      "latitude": 25.752486,
      "longitude": -80.377892,
      "description": ""
    },
    {
      "abbreviation": "PC",
      "full_name": "Charles E. Perry Building (Primera Casa)",
      "latitude": 25.755542,
      "longitude": -80.373745,
      "description": ""
    },
    {
      "abbreviation": "PCA",
      "full_name": "Paul L. Cejas School of Architecture",
      "latitude": 25.7587,
      "longitude": -80.375337,
      "description": ""
    },
    {
      "abbreviation": "PG1",
      "full_name": "Gold Parking Garage",
      "latitude": 25.754835,
      "longitude": -80.372078,
      "description": ""
    },
    {
      "abbreviation": "PG2",
      "full_name": "Blue Parking Garage",
      "latitude": 25.753851,
      "longitude": -80.372083,
      "description": ""
    },
    {
      "abbreviation": "PG3",
      "full_name": "Panther Parking Garage",
      "latitude": 25.758454,
      "longitude": -80.379828,
      "description": ""
    },
    {
      "abbreviation": "PG4",
      "full_name": "Red Parking Garage",
      "latitude": 25.760161,
      "longitude": -80.373152,
      "description": ""
    },
    {
      "abbreviation": "PG5",
      "full_name": "PG5 Market Station",
      "latitude": 25.760167,
      "longitude": -80.371646,
      "description": ""
    },
    {
      "abbreviation": "PG6",
      "full_name": "Parking Garage 6",
      "latitude": 25.760178,
      "longitude": -80.374551,
      "description": ""
    },
    {
      "abbreviation": "PH",
      "full_name": "Panther Hall",
      "latitude": 25.754067,
      "longitude": -80.376586,
      "description": ""
    },
    {
      "abbreviation": "PVH",
      "full_name": "Parkview Hall",
      "latitude": 25.754369,
      "longitude": -80.377497,
      "description": ""
    },
    {
      "abbreviation": "RB",
      "full_name": "Ryder Business Building",
      "latitude": 25.757427,
      "longitude": -80.376124,
      "description": ""
    },
    {
      "abbreviation": "RDB",
      "full_name": "Rafael Diaz-Balart Hall",
      "latitude": 25.756828,
      "longitude": -80.377819,
      "description": ""
    },
    {
      "abbreviation": "RH",
      "full_name": "Ronald W. Reagan Presidential House",
      "latitude": 25.755495,
      "longitude": -80.36944,
      "description": ""
    },
    {
      "abbreviation": "SAAC",
      "full_name": "Student Athletic Academic Center",
      "latitude": 25.75605,
      "longitude": -80.382282,
      "description": ""
    },
    {
      "abbreviation": "SASC",
      "full_name": "Student Academic Success Center",
      "latitude": 25.755812,
      "longitude": -80.37146,
      "description": ""
    },
    {
      "abbreviation": "SH",
      "full_name": "Solar House",
      "latitude": 25.759549,
      "longitude": -80.376961,
      "description": ""
    },
    {
      "abbreviation": "SHC",
      "full_name": "Student Health Center",
      "latitude": 25.755882,
      "longitude": -80.376758,
      "description": ""
    },
    {
      "abbreviation": "SIPA1",
      "full_name": "Steven J. Green School of International and Public Affairs 1",
      "latitude": 25.756495,
      "longitude": -80.376126,
      "description": ""
    },
    {
      "abbreviation": "SIPA2",
      "full_name": "Steven J. Green School of International and Public Affairs 2",
      "latitude": 25.756477,
      "longitude": -80.376716,
      "description": ""
    },
    {
      "abbreviation": "SPE",
      "full_name": "Sigma Phi Epsilon Learning Center",
      "latitude": 25.753596,
      "longitude": -80.369925,
      "description": ""
    },
    {
      "abbreviation": "TAM",
      "full_name": "Tamiami Hall",
      "latitude": 25.752918,
      "longitude": -80.375718,
      "description": ""
    },
    {
      "abbreviation": "TWR",
      "full_name": "Tower / Veteran and Military Affairs",
      "latitude": 25.75612,
      "longitude": -80.376356,
      "description": ""
    },
    {
      "abbreviation": "TDBC",
      "full_name": "Trish and Dan Bell Chapel",
      "latitude": 25.75631,
      "longitude": -80.37036,
      "description": ""
    },
    {
      "abbreviation": "UAA",
      "full_name": "University Apartments — Building A",
      "latitude": 25.758053,
      "longitude": -80.369831,
      "description": ""
    },
    {
      "abbreviation": "UAB",
      "full_name": "University Apartments — Building B",
      "latitude": 25.75806,
      "longitude": -80.369123,
      "description": ""
    },
    {
      "abbreviation": "UAC",
      "full_name": "University Apartments — Building C",
      "latitude": 25.757858,
      "longitude": -80.369549,
      "description": ""
    },
    {
      "abbreviation": "UAD",
      "full_name": "University Apartments — Building D",
      "latitude": 25.757414,
      "longitude": -80.369418,
      "description": ""
    },
    {
      "abbreviation": "UAE",
      "full_name": "University Apartments — Building E",
      "latitude": 25.757381,
      "longitude": -80.368908,
      "description": ""
    },
    {
      "abbreviation": "UAF",
      "full_name": "University Apartments — Building F",
      "latitude": 25.758731,
      "longitude": -80.368971,
      "description": ""
    },
    {
      "abbreviation": "UAG",
      "full_name": "University Apartments — Building G",
      "latitude": 25.758683,
      "longitude": -80.36943,
      "description": ""
    },
    {
      "abbreviation": "UAH",
      "full_name": "University Apartments — Building H",
      "latitude": 25.758642,
      "longitude": -80.369874,
      "description": ""
    },
    {
      "abbreviation": "UAJ",
      "full_name": "University Apartments — Building J",
      "latitude": 25.758688,
      "longitude": -80.370317,
      "description": ""
    },
    {
      "abbreviation": "UAK",
      "full_name": "University Apartments — Building K",
      "latitude": 25.757699,
      "longitude": -80.370048,
      "description": ""
    },
    {
      "abbreviation": "UAL",
      "full_name": "University Apartments — Building L",
      "latitude": 25.757366,
      "longitude": -80.370402,
      "description": ""
    },
    {
      "abbreviation": "UT",
      "full_name": "University Towers",
      "latitude": 25.754865,
      "longitude": -80.375399,
      "description": ""
    },
    {
      "abbreviation": "VH",
      "full_name": "Viertes Haus",
      "latitude": 25.757961,
      "longitude": -80.374699,
      "description": ""
    },
    {
      "abbreviation": "WRC",
      "full_name": "Wellness And Recreation Center",
      "latitude": 25.755798,
      "longitude": -80.377967,
      "description": ""
    },
    {
      "abbreviation": "W01",
      "full_name": "West 1 - Sculpture + Art Foundation",
      "latitude": 25.752764,
      "longitude": -80.382307,
      "description": ""
    },
    {
      "abbreviation": "W01C",
      "full_name": "West 01C - Ceramics",
      "latitude": 25.752764,
      "longitude": -80.381504,
      "description": ""
    },
    {
      "abbreviation": "W03",
      "full_name": "West 3 - Key Control",
      "latitude": 25.753497,
      "longitude": -80.382476,
      "description": ""
    },
    {
      "abbreviation": "W06",
      "full_name": "West 6 — Training Lab",
      "latitude": 25.755708,
      "longitude": -80.382104,
      "description": ""
    },
    {
      "abbreviation": "W09",
      "full_name": "West 9 — Painting",
      "latitude": 25.756827,
      "longitude": -80.382651,
      "description": ""
    },
    {
      "abbreviation": "W10",
      "full_name": "West 10 — Drawing and MFA Studios",
      "latitude": 25.756922,
      "longitude": -80.383894,
      "description": ""
    },
    {
      "abbreviation": "W10A",
      "full_name": "ROTC — Reserve Officers’ Training Corps",
      "latitude": 25.757269,
      "longitude": -80.383632,
      "description": ""
    },
    {
      "abbreviation": "W10C",
      "full_name": "Trailer (Administrative Systems II)",
      "latitude": 25.756894,
      "longitude": -80.382927,
      "description": ""
    },
    {
      "abbreviation": "WC",
      "full_name": "Wertheim Conservatory",
      "latitude": 25.759122,
      "longitude": -80.373123,
      "description": ""
    },
    {
      "abbreviation": "WPAC",
      "full_name": "Herbert and Nicole Wertheim Performing Arts Center",
      "latitude": 25.752534,
      "longitude": -80.372669,
      "description": ""
    },
    {
      "abbreviation": "WSTC",
      "full_name": "Women’s Softball/Tennis Center",
      "latitude": 25.757484,
      "longitude": -80.381723,
      "description": ""
    },
    {
      "abbreviation": "ZEB",
      "full_name": "Sanford L. Ziff Family Education Building",
      "latitude": 25.758904,
      "longitude": -80.37673,
      "description": ""
    }
];

// Create a Leaflet marker for every building in the list above.
buildings.forEach((building) => {
    const marker = L.marker([building.latitude, building.longitude]).addTo(map);
    marker.bindPopup(
        `<b>${building.full_name} (${building.abbreviation})</b>` +
        (building.description ? `<br>${building.description}` : "")
    );
});
