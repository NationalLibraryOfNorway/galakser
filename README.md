# Ordnettverk · Galakser (PWA)

En moderne Progressive Web App (PWA) basert på Streamlit-appen [`Yoonsen/galaxy_streamlit`](https://github.com/Yoonsen/galaxy_streamlit) og dualgraf-rammeverket i `dual_graphs_yoonsen`, som henter ordgalakser direkte fra Nasjonalbibliotekets trigrambase ([DH-lab](https://nb.no/dh-lab)).

## Hva applikasjonen gjør

**Ordgalakser** bygger et nettverk av ord ut fra *koordinasjoner* i Nasjonalbibliotekets tekstsamlinger – altså konstruksjoner der ord opptrer sideordnet med bindeord som «og», «eller» og komma (f.eks. *«is og snø»* eller *«frihet og demokrati»*). Når to ord stadig sidestilles i språkbruken, indikerer det at de tilhører samme semantiske felt eller samme diskursive ramme.

Fra søkeordet $x$ går applikasjonen **to steg ut i koordinasjonsgrafen** ($x \to y \to z$):
1. Først hentes de mest sentrale ordene $y$ som koordineres direkte med $x$.
2. Deretter hentes ordene $z$ som i sin tur koordineres med $y$.

Dermed fanger grafen både det umiddelbare nabolaget rundt søkeordet og den bredere konteksten som naboordene inngår i. Ved å partisjonere og analysere grafen med **Leiden/Louvain-clustre**, **hierarkiske $k$-klikker** og **overlappsclustre over linjegrafen $L(G)$** (med topologisk lekkasjestopper og entropibasert hub-sanering), viser applikasjonen hvordan ord henger sammen og gjør det mulig å undersøke både diskursive mønstre og betydningsnyanser:

- **Betydningsaspekter og polysemi/homonymi (f.eks. «is» eller «pålegg»):** Et ord som *«is»* forgreiner seg i distinkte klynger for vær og føre (*snø, kulde, slaps*), mat og dessert (*kaker, brus, sjokolade*) og polare strøk, mens *«pålegg»* splittes mellom matvarer (*brød, smør, pølser*) og juridiske direktiver (*forbud, instrukser, tvangsmulkt*).
- **Politiske og ideologiske begreper (f.eks. «kommunisme» eller «frihet»):** Avdekker diskursive sammenhenger og hvilke begreper som historisk stilles sammen i offentligheten – fra styringsformer og ideologiske motpoler (*fascisme, nazisme, kapitalisme, sosialisme*) til verdibegreper og samfunnsinstitusjoner.
- **Stedsnavn og geografi (f.eks. «Paris»):** Samler europeiske metropoler, kulturbyer og reisemål (*London, Berlin, Roma, Wien*) og viser hvilke geografiske, politiske og kulturelle akser et sted inngår i.
- **Fornavn og etternavn (f.eks. «Per» eller «Hamsun»):** Fornavn som *«Per»* får frem vanlige navnepar og fortellingskontekster (*Pål, Espen, Kari, Ola*), mens etternavn som *«Hamsun»* plasserer forfatteren i det litterære og idéhistoriske landskapet (*Ibsen, Bjørnson, Undset, Kinck, Dostojevskij*).

## Funksjoner

- **Interaktiv nettverksgraf (Canvas 2D Force-Directed)**:
  - Fargekodet etter Louvain-clustre og skalert etter gradssentralitet (`degree_centrality`).
  - Justerbar spredning (`spread`), tekststørrelse (`fontsize`), retningspiler, pan/zoom (inkl. pinch-to-zoom på mobil/nettbrett) og PNG-eksport.
  - Klikk på en node for å inspisere grad, sentralitet, betweenness, eller dobbeltklikk for å åpne ny galakse for ordet.
- **Clustre (`community_dict`)**:
  - Klientside Louvain-modularitetsoptimalisering der hvert cluster navngis etter de to mest sentrale ordene (f.eks. `frihet-uavhengighet`, `demokrati-folkestyre`).
- **Overlappsclustre (`dual_graphs_yoonsen` – Linjegraf + Louvain + Attachment)**:
  - Bygger linjegrafen $L(G)$ der kantene er noder, kjører flernivå-Louvain på både $G$ og $L(G)$, og knytter linjegraf-klynger til de opprinnelige klyngene (`match_clusters_with_overlap` med enten *Beste overlapp* eller *Jaccard-terskel*).
  - Gir 100 % nodedekning kombinert med naturlig overlapp for polyseme bro-ord, inkludert oversikt over bro-ord, grådig *Set-Cover* og sammenligning mot vanlig Louvain og klikk-perkolasjon.
- **Klikkstruktur (`kcliques` + `subsetgraph`)**:
  - Eksakt Bron–Kerbosch + $k$-klikk-perkolasjon (`k_clique_communities` for $k \ge 3$) der hver klikk navngis med kode og de to mest sentrale ordene (f.eks. `3-1 · is-snø`, `4-2 · demokrati-folkestyre`).
  - Strengt hierarkisk inklusjonstre (SVG-tretegner + ekspanderbare trenoder + listevisning) der toppklikkene ($k=3$) danner hovedinndelinger som splittes videre i $4$-klikker, $5$-klikker osv. ved inklusjon.
- **Sentralitetstabell**:
  - Sorterbar oversikt over `Degree Centrality`, `Betweenness Centrality` (Brandes' algoritme) og `Closeness Centrality`.
- **Sti mellom noder (`path` / `paths`)**:
  - Finner korteste sti og flere enkle stier (inntil 3 steg) i både rettet (`directed`) og urettet (`undirected`) graf, og uthever stien direkte i grafen.
- **Full PWA & Offline-støtte**:
  - Installerbart manifest (`manifest.webmanifest`) og Service Worker (`sw.js`) som mellomlagrer applikasjonsskallet og tidligere søkte galakser for offline-bruk.

## Kjøre lokalt

```bash
npm install
npm run dev
```

Bygg for produksjon (statiske filer i `dist/` klare for GitHub Pages / statisk hosting):

```bash
npm run build
npm run preview
```
