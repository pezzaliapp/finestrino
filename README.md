# Finestrino

Il cielo sopra di te, adesso. Finestrino mostra gli aerei e i satelliti che ti passano sopra in questo momento, nella loro posizione reale, con il sole, la luna e le stelle al posto giusto. Tocchi un aereo o un satellite, premi **Sali a bordo** e guardi il mondo dal suo finestrino, sopra il rilievo vero della Terra.

È un sito statico: niente server, niente account, niente chiavi API, niente abbonamenti. Lo ospiti gratis su GitHub Pages.

## Cosa fa

- **Dal basso**: sei nel tuo luogo e guardi il cielo. Trascina per guardarti intorno, pizzica o usa la rotella per zoomare.
- **Dall'alto**: esplori la zona come su una mappa 3D e scegli un aereo.
- **A bordo**: finestrino sinistro, destro o vista avanti. Puoi guardarti intorno trascinando.
- **Meteo vero**: temperatura e cielo del tuo luogo, con nuvole disegnate in base alla copertura reale.
- **Satelliti**: la Stazione Spaziale Internazionale, Tiangong e i ~150 satelliti più luminosi. Dall'oblò del satellite vedi la Terra dall'orbita.
- Si può installare sul telefono come app (menu del browser, "Aggiungi a schermata Home").

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

## Da dove vengono i dati, e perché è tutto gratis

| Cosa | Fonte | Condizioni |
| --- | --- | --- |
| Aerei | [ADSB.lol](https://adsb.lol) | API aperta, dati ODbL. L'autore ha annunciato che in futuro potrebbe servire una chiave, ottenibile inviando dati con un proprio ricevitore. |
| Aerei (riserva) | [adsb.fi](https://adsb.fi) | Uso personale non commerciale, massimo 1 richiesta al secondo, va citato. L'app rispetta il limite. |
| Satelliti | [CelesTrak](https://celestrak.org) + [satellite.js](https://github.com/shashwatak/satellite-js) | Dati scaricati al massimo una volta ogni 2 ore per browser, come chiede CelesTrak. |
| Immagini della Terra | [Sentinel-2 cloudless di EOX](https://s2maps.eu) | Gratis per uso non commerciale con attribuzione. |
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
manifest.webmanifest  installazione come app
```

## Licenza

Il codice è sotto licenza MIT. I dati mostrati appartengono alle rispettive fonti e seguono le loro condizioni (vedi tabella sopra e il pulsante **Fonti dei dati** nell'app).
