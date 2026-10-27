const nyc_map = L.map("nyc_map", {
    maxBounds: [[40.49, -74.27], [40.92, -73.68]],
    minZoom: 12
}).setView([40.726997, -73.984291], 12);

let search_zone;
const search_radius_m = 500;
const search_radius_km = search_radius_m / 1000;
//iNaturalist api consts
// https://api.inaturalist.org/v1/observations/species_counts?place_id=48&quality_grade=research&lat=40.78&lng=-73.96&radius=0.5
const base_url = "https://api.inaturalist.org/v1/observations";
// const nyc_id = "place_id=674"; 
const nystate_id = "place_id=48";
const quality_grade = "quality_grade=research";

//observations - state vs local 
const state_total_promise = fetchTotal();
const min_obs = 10;

L.tileLayer(`https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png?key=${CARTO_KEY}`, {
    attribution: "&copy; OpenStreetMap contributors &copy; CARTO"
}).addTo(nyc_map);

//map clicks 
nyc_map.on("click", async function (e) {
    // console.log(e.latlng); //click coords
    if (!search_zone) {
        search_zone = L.circle([e.latlng.lat, e.latlng.lng], { radius: search_radius_m })
            .addTo(nyc_map);
    } else {
        search_zone.setLatLng([e.latlng.lat, e.latlng.lng]);
    }
    const results = await fetchSpecies(e.latlng.lat, e.latlng.lng, (search_radius_km));
    const species = results.slice(0, 5);
    //total observations 
    const state_total = await state_total_promise;
    const local_total = await fetchTotal(`lat=${e.latlng.lat}&lng=${e.latlng.lng}&radius=${search_radius_km}`);
    // console.log(state_total, local_total);
    const keep_species = results.filter(d => d.count >= min_obs);
    const ids = keep_species.map(d => d.taxon.id);
    //filtering + mapping + adding local distinctiveness score
    const ids_str = ids.join(",");
    const state_lookup = await fetchStateCounts(ids_str);
    const scored_species = [];
    for (const d of keep_species) {
        if (!state_lookup.has(d.taxon.id)) continue;
        const ld_score = (d.count / local_total) / (state_lookup.get(d.taxon.id) / state_total);
        const scored = { ...d, score: ld_score };
        scored_species.push(scored);
    }
    //console.table(scored_species);
    //sort by score
    scored_species.sort((a, b) => b.score - a.score);
    const dist_species = scored_species.slice(0, 5);
    //labels: native|introduced|unknown|at-risk 
    const combined_species = [...species, ...dist_species];
    const combined_ids = combined_species.map(d => d.taxon.id);
    const combined_ids_str = combined_ids.join(",");
    const [native_set, introed_set, atrisk_set] = await Promise.all([
        fetchIDSet(combined_ids_str, "native=true"),
        fetchIDSet(combined_ids_str, "introduced=true"),
        fetchIDSet(combined_ids_str, "threatened=true"),
    ]);
    const tagged_species = [];
    for (const d of combined_species) {
        const status = native_set.has(d.taxon.id) ? "native"
            : introed_set.has(d.taxon.id) ? "introduced"
                : "unknown";
        const at_risk = atrisk_set.has(d.taxon.id);
        const tagged = { ...d, status: status, at_risk: at_risk };
        tagged_species.push(tagged);
    }
    //console.log(tagged_species);
    //render
    renderSpecies(tagged_species.slice(0, species.length), "common_list");
    renderSpecies(tagged_species.slice(species.length), "distinctive_list");
});

async function fetchSpecies(lat, lng, radius_km) {
    const url = `${base_url}/species_counts?${nystate_id}&${quality_grade}&lat=${lat}&lng=${lng}&radius=${radius_km}`;
    const response = await fetch(url);
    if (!response.ok) {
        console.log("Request failed:", response.status);
        return [];
    }
    const data = await response.json();
    console.log(data);
    // console.log(data.total_results);
    // console.log(data.results[0].taxon.preferred_common_name, data.results[0].count);
    return data.results;
}

function renderSpecies(species, list_id) {
    const container = document.getElementById(list_id);
    container.innerHTML = "";
    for (const d of species) {
        const common_name = d.taxon.preferred_common_name ?? d.taxon.name;
        const scientific_name = d.taxon.name;
        const count = d.count;
        // const photo_sm = d.taxon.default_photo?.square_url;
        const photo_med = d.taxon.default_photo?.medium_url;
        const photo_cred = d.taxon.default_photo?.attribution;
        const at_risk = d.at_risk === true ? `<span class="tag at_risk">at risk</span>` : "";
        const status = d.status;
        container.innerHTML += `
        <div class="species_card">
            <img src="${photo_med}" alt="${common_name}" title="${photo_cred}">
            <h3>${common_name}</h3>
            <p class="sci_name">${scientific_name}</p>
            <div class="tags">
                <span class="tag ${status}">${status}</span>
                ${at_risk}
            </div>
            <p>${count} observations</p>
        </div>`;
    }
}

async function fetchTotal(extra_params = "") {
    const url = `${base_url}?${nystate_id}&${quality_grade}&per_page=0&${extra_params}`;
    const response = await fetch(url);
    if (!response.ok) {
        console.log("Request failed:", response.status);
        return 0;
    }
    const data = await response.json();
    return data.total_results;
}

async function fetchStateCounts(ids) {
    const url = `${base_url}/species_counts?${nystate_id}&${quality_grade}&taxon_id=${ids}&per_page=500`;
    const response = await fetch(url);
    const species_lookup = new Map();
    if (!response.ok) {
        console.log("Request failed:", response.status);
        return species_lookup;
    }
    const data = await response.json();
    for (const d of data.results) {
        species_lookup.set(d.taxon.id, d.count)
    }
    return species_lookup;
}

async function fetchIDSet(ids, filter) {
    const url = `${base_url}/species_counts?${nystate_id}&${quality_grade}&taxon_id=${ids}&per_page=500&${filter}`;
    const response = await fetch(url);
    const id_set = new Set([]);
    if (!response.ok) {
        console.log("Request failed:", response.status);
        return id_set;
    }
    const data = await response.json();
    for (const d of data.results) {
        id_set.add(d.taxon.id);
    }
    return id_set;
}