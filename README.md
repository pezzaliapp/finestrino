# Finestrino

Il cielo sopra di te, adesso. Finestrino mostra gli aerei e i satelliti che ti passano sopra in questo momento, nella loro posizione reale, con il sole, la luna e le stelle al posto giusto. Tocchi un aereo o un satellite, premi **Sali a bordo** e guardi il mondo dal suo finestrino, sopra il rilievo vero della Terra.

È un sito statico: niente server, niente account, niente chiavi API, niente abbonamenti. Lo ospiti gratis su GitHub Pages.

## Cosa fa

- **Dal basso**: sei nel tuo luogo e guardi il cielo. Trascina per guardarti intorno, pizzica o usa la rotella per zoomare.
- **Dall'alto**: esplori la zona come su una mappa 3D e scegli un aereo.
- **A bordo**: finestrino sinistro, destro o vista avanti. Puoi guardarti intorno trascinando.
- **Cerca un volo**: scrivi il numero del volo (FR1234), il codice radio (RYR4KX) o la registrazione (EI-DYC) e sali direttamente a bordo.
- **Da dove viene e dove va**: nella scheda e a bordo compaiono compagnia, partenza e arrivo (es. Bergamo → Bari), con decollo e atterraggio stimati e la percentuale di percorso.
- **Sopra di me**: gli aerei più vicini sopra il tuo orizzonte, con la direzione in cui guardare, e i prossimi passaggi visibili della Stazione Spaziale, da aggiungere al calendario.
- **Condividi il finestrino**: un link che porta chi lo apre sullo stesso aereo o satellite, in diretta. Con anteprima per WhatsApp, Telegram e social.
- **Navi e traghetti**: punti azzurri sul mare con nome, tipo (traghetto, cargo, peschereccio, barca a vela…), velocità, destinazione e orario di arrivo dichiarato dall'equipaggio. Visibili da terra, dal finestrino e dall'oblò dei satelliti.
- **Rumore di cabina**: a bordo degli aerei senti il rombo della cabina, generato dal vivo nel browser (nessun file audio). Il pulsante **Suono** lo spegne. Sui satelliti c'è silenzio.
- **Si aggiorna da sola**: chi ha l'app aperta riceve la nuova versione entro 5 minuti dalla pubblicazione, senza svuotare la cache.
- **Notte vera**: giorno e notte seguono l'ora reale. Di notte la Terra è buia e si accendono le luci delle città (NASA Black Marble).
- **Meteo vero**: temperatura e cielo del tuo luogo, con nuvole disegnate in base alla copertura reale.
- **Satelliti**: la Stazione Spaziale Internazionale, Tiangong e i ~150 satelliti più luminosi. Dall'oblò del satellite vedi la Terra dall'orbita.
- Si può installare sul telefono come app (menu del browser, "Aggiungi a schermata Home").

## Pubblicare una modifica

Dopo aver cambiato qualcosa, dal terminale nella cartella del progetto:

```bash
./pubblica.sh "cosa hai cambiato"
```

Lo script scrive un nuovo numero in `version.json`, fa commit e push. L'app aperta sui dispositivi controlla quel file ogni 5 minuti (e quando torni sulla scheda): se è cambiato si ricarica da sola, ma non mentre sei a bordo di un aereo.

## Pubblicarla gratis su GitHub Pages

1. Crea una repository pubblica chiamata `finestrino` su GitHub.
2. Carica tutti i file di questa cartella mantenendo la struttura (`index.html`, `css/`, `js/`, ecc.). Dal sito di GitHub: **Add file → Upload files**, trascina dentro tutto, poi **Commit changes**.
3. Vai su **Settings → Pages**. In **Source** scegli **Deploy from a branch**, poi branch `main` e cartella `/ (root)`. Salva.
4. Dopo uno o due minuti l'app è online su `https://TUO-NOME.github.io/finestrino/`.

GitHub Pages usa HTTPS, che serve al browser per condividere la posizione.

Per provarla sul computer senza pubblicarla:

```bash
python3 -m http.server 8000
# poi apri http://localhost:8000
```

Aprire `index.html` con doppio clic non funziona: i moduli JavaScript richiedono un server, anche locale.

## Attivare gli aerei (intermediario gratuito su Vercel)

Le fonti dei dati degli aerei non permettono richieste dirette da una pagina web di un altro sito (blocco CORS). Serve un piccolo intermediario: la cartella `finestrino-proxy`, una funzione che gira gratis su Vercel (piano Hobby, uso personale non commerciale, senza carta di credito: oltre i limiti si ferma, non addebita nulla). Prova nell'ordine adsb.lol, adsb.fi e OpenSky Network.

Cloudflare Workers non va bene: adsb.lol risponde 429 e adsb.fi blocca i server Cloudflare.

Da terminale (serve Node.js):

```bash
cd finestrino-proxy
npx vercel login
npx vercel deploy --prod --yes
```

Il comando stampa un indirizzo come `https://finestrino-proxy.vercel.app`. Scrivilo in `js/config.js`:

```js
export const AIRCRAFT_PROXY = 'https://finestrino-proxy.vercel.app';
```

Se pubblichi l'app su un dominio diverso, aggiungilo alla lista `ALLOWED` in `finestrino-proxy/api/point.js` e `finestrino-proxy/api/ships.js` e ripeti il deploy.

### Navi (aisstream.io)

Registrati gratis su [aisstream.io](https://aisstream.io), crea una chiave nella pagina API Keys e salvala su Vercel (non va mai scritta nel codice):

```bash
cd finestrino-proxy
npx vercel env add AISSTREAM_KEY production
npx vercel deploy --prod --yes
```

## Da dove vengono i dati, e perché è tutto gratis

| Cosa | Fonte | Condizioni |
| --- | --- | --- |
| Aerei | [ADSB.lol](https://adsb.lol) | API aperta, dati ODbL. L'autore ha annunciato che in futuro potrebbe servire una chiave, ottenibile inviando dati con un proprio ricevitore. |
| Aerei (riserva) | [adsb.fi](https://adsb.fi) e [OpenSky Network](https://opensky-network.org) | Uso personale non commerciale, massimo 1 richiesta al secondo, va citato. L'app rispetta il limite. |
| Rotte dei voli | [adsbdb](https://www.adsbdb.com) | Gratuito. Dati delle rotte di David Taylor e Jim Mason: mostrati a ogni richiesta, mai copiati in un nostro database. |
| Navi | [aisstream.io](https://aisstream.io) | Gratuito per uso non commerciale con una chiave personale, che resta nascosta su Vercel (variabile `AISSTREAM_KEY`). Posizioni con 1-3 minuti di ritardo. |
| Satelliti | [CelesTrak](https://celestrak.org) + [satellite.js](https://github.com/shashwatak/satellite-js) | Dati scaricati al massimo una volta ogni 2 ore per browser, come chiede CelesTrak. |
| Immagini della Terra | [Sentinel-2 cloudless di EOX](https://s2maps.eu) | Gratis per uso non commerciale con attribuzione. |
| Luci notturne | NASA Black Marble tramite [GIBS](https://earthdata.nasa.gov/gibs) | Gratuito, nessuna chiave, dominio pubblico NASA. Composito annuale, non in diretta. |
| Rilievo 3D | Terrain Tiles di Mapzen su AWS Open Data | Gratis, nessuna chiave. |
| Meteo e ricerca luoghi | [Open-Meteo](https://open-meteo.com) | Gratis per uso non commerciale, CC BY 4.0. |
| Motore 3D | [CesiumJS](https://cesium.com/platform/cesiumjs/) | Apache 2.0. Non usa Cesium ion, quindi nessun token. |
| Font | B612 (Google Fonts) | OFL. È il font progettato da Airbus per i display della cabina di pilotaggio. |

Non viene usato nulla di Google Maps, Google 3D Tiles, Mapbox, MapTiler o airplanes.live, perché richiedono chiavi o accordi.

## Limiti da conoscere

- **Uso non commerciale.** Le immagini EOX, adsb.fi e Open-Meteo sono gratuite solo per uso non commerciale. Se un giorno vuoi guadagnarci (pubblicità, abbonamenti), dovrai cambiare queste fonti o ottenere una licenza.
- **Niente edifici fotorealistici.** Vedi il rilievo vero con l'immagine satellitare sopra. Da 10.000 m è molto realistico; a bassa quota gli edifici non ci sono.
- **Copertura degli aerei.** Dipende dai ricevitori dei volontari: ottima in Europa e Nord America, scarsa sugli oceani.
- **Non è uno strumento di navigazione.** Le posizioni possono arrivare in ritardo o mancare.

## Struttura

```
index.html            pagina e interfaccia
css/style.css         stile (cabina, finestrino, pannelli)
js/app.js             logica: cielo, mappa, salita a bordo
js/terrain.js         rilievo 3D gratuito per Cesium
js/aircraft.js        dati degli aerei e stima della posizione tra un aggiornamento e l'altro
js/satellites.js      orbite e posizioni dei satelliti
js/weather.js         meteo e ricerca luoghi
js/geo.js             funzioni geografiche
js/config.js          indirizzo del Worker per gli aerei
finestrino-proxy/     intermediario gratuito per i dati degli aerei (Vercel)
js/audio.js           rumore di cabina generato dal vivo
js/update.js          controllo nuove versioni
sw.js                 service worker: file sempre aggiornati, copia offline
version.json          numero di versione (lo aggiorna pubblica.sh)
pubblica.sh           pubblica una modifica con un comando
js/flights.js         ricerca dei voli e rotte
js/sky.js             passaggi visibili della Stazione Spaziale e file calendario
og-image.png          anteprima per i social
manifest.webmanifest  installazione come app
```

## Licenza

Il codice è sotto licenza MIT. I dati mostrati appartengono alle rispettive fonti e seguono le loro condizioni (vedi tabella sopra e il pulsante **Fonti dei dati** nell'app).
