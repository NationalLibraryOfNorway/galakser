# Ordnettverk · Galakser (PWA)

En moderne Progressive Web App (PWA) basert på Streamlit-appen [`Yoonsen/galaxy_streamlit`](https://github.com/Yoonsen/galaxy_streamlit), som henter ordgalakser direkte fra Nasjonalbibliotekets trigrambase ([DH-lab](https://nb.no/dh-lab)).

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
- **Klikkstruktur (`kcliques`)**:
  - Eksakt Bron–Kerbosch + $k$-klikk-perkolasjon (`k_clique_communities` for $k \ge 3$) som grupperer tette undergrafer (`3-1`, `4-1`, osv.).
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
