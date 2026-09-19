/**
 * What a new workspace is called until it is called something better: a
 * city, as Conductor does it. A name that says nothing about the work is the
 * honest one for work that has not started, it is easy to say and to tell
 * apart from the next, and it is safe as a folder and as a branch.
 *
 * The folder keeps the name for good — pi keeps a folder's conversations by
 * its path — and the branch is what gets renamed once the work has a subject.
 */
export const CITIES = [
	"amsterdam", "athens", "auckland", "austin", "bangkok", "barcelona", "beirut", "belgrade", "bergen", "berlin",
	"bogota", "bologna", "bordeaux", "boston", "bratislava", "brisbane", "bristol", "brussels", "budapest", "busan",
	"cairo", "calgary", "canberra", "cardiff", "chicago", "cologne", "copenhagen", "cordoba", "dakar", "dallas",
	"delft", "denver", "dresden", "dublin", "edinburgh", "florence", "fukuoka", "geneva", "genoa", "ghent",
	"glasgow", "gothenburg", "granada", "hamburg", "hanoi", "havana", "helsinki", "hobart", "istanbul", "jakarta",
	"kyoto", "lagos", "leipzig", "lima", "lisbon", "ljubljana", "london", "lyon", "madrid", "malmo",
	"manila", "marseille", "melbourne", "milan", "montreal", "munich", "nagoya", "nairobi", "nantes", "naples",
	"nice", "oakland", "osaka", "oslo", "ottawa", "oxford", "palermo", "paris", "perth", "porto",
	"prague", "quebec", "reykjavik", "riga", "rome", "rotterdam", "santiago", "sapporo", "seattle", "seoul",
	"seville", "sofia", "stockholm", "sydney", "taipei", "tallinn", "tokyo", "toronto", "trenton", "turin",
	"utrecht", "valencia", "vancouver", "venice", "vienna", "vilnius", "warsaw", "wellington", "zagreb", "zurich",
];

/**
 * A city not in `taken`, picked at random. When every city is taken, the
 * next round of them: `lisbon-v2`, and so on.
 */
export function pickCity(taken, random = Math.random) {
	const used = new Set(taken);
	for (let round = 1; ; round++) {
		const free = CITIES.map((city) => (round === 1 ? city : `${city}-v${round}`)).filter((name) => !used.has(name));
		if (free.length > 0) return free[Math.floor(random() * free.length)];
	}
}
