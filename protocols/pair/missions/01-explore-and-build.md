# Mission 01 Explore and Build

trenutno koristimo Polymarket-bot - to je kompletna infrastruktura za backtesting, livetrading, razvoj strategija, analizu.

Sada pravimo autonomni strategy research protocol "pair" on top of the  polymarket-bot. Taj protocol treba da bude specifican samo za ovu strategiju.

Treba da radi autonomno 24/7 danima, nedeljama, mesecima. Nije cilj da se jednom pokrene i da nadje strategiju koja radi, nego posle toga da je unapredjuje non stop. Trziste se stalno menja tako da strategija nece raditi vecno, treba da bude adaptivna, kako se trziste menja i ona da se menja i da postaje sve bolja i bolja.

Trenutno se fokusiramo samo na bitcoin 15 min, dok ne nadjemo strategiju i dok je ne pustim na live i ne dokazem da zaradjuju pare. Kada prodjemo ovu fazu posle cemo ici na jos symbols ( eth, sol, xrp ) i jos timeframes ( 5m, 1h, 4h, 1d) ali to je tek kasnije, kada uspesno prvo napravim da radi na btc 15min - znaci ovo hocemo ali ne sada, sada je fokus samo na 15 min.

Strategija je opisana u protocols/pair/RULES.md

Todays models like Fable 5 or GPT 5.6 are much more capable than humans, mogu mnogo bolje da dizajniraju sisteme za ai nego sto ljudi mogu, zato i ne zelim da pisem detaljna upustva nego samo stvari koje zelim da postignem a dajem modelima punu slobodu da sami dizajiraju sebi OS ( protocol ) kako god oni zele ili misle da je najbolje, zato sto ce bolje dizajnirati sami sebi nego sto bih ja, tako da poneta ovog pasusa je da im dajem slobodu da sami rade sta misle da je potrebno.

## Goal
### Capabilities
- research complete polymarket-bot capabilities as we will build or protocol on to of it. Nemoj da verujes dokumentaciji, proveri u code, a takodje i verifikuj, nemoj ni code-u da verujes na slepo. Cilj je da saznamo koje strategije mozemo da pravimo i da one 100% isto se izvsavaju i na live i na backtesting, tako da nemamo problema oko toga, da jednom kad napravimo da radi na backtestingu da znamo da ce raditi i na live. Ovo je jako bitan korak treba da pokrene backtest, da pokrene fleet, da proveri sta je upisano u bazi, da li ce neke metrike faliti za ovu nasu strategiju, koje metrike su bitne itd... Jednostavno da istrazi sistem tako da bude upoznat sa njim, moze i da pravi beleske samo za AI ne mora za human - ako ce tako jos bolje raditi.

Takodje jako je bitno da protocol moze da se self upgrade, znaci ja cu sigurno nastaviti da radim na engine-u i kada napravim neke promene da mogu da pokrenem neku komand ili kako god ti smislis da je najbolje da on doda te features u Capabilities. Primer u sledecih par nedelja treba da dodam jos jedan ogroman feature na engine a to je ceo dataset od svih trades + activies za crypto ( btc,eth,sol,xrp) za timeframes (5m,15m,1h,4h,1d) i kada to napravim hocu da ovaj protocol moze i to da koristi. Ovo sam ti dao kao primer, nemoj da se vezujes za ovaj feature, kad bude bio obavesticu te.

### Tools
Treba da napravi sve tools za :
- stvari koje trenutno postoje:
    - pokretanje backtestova ( single, batch )
    - citanje backtest rezultata
    - uporedjivanje rezultata
    - proverava status queue ( koliko ima machines, sa koliko procesora, koliko ima jobs na queue i slicno)
    - sta god ti mislis da je potrebno ovo iznad sam samo naveo kao primer
- koje ce biti potrebni za research fazu
    - sta god ti mislis da je potrebno za ovaj protocol i research fazu da unapredi i olaksa

### Memory
Stateless - everything lives in files, after each step we write in memory system. Agents can be stoped at any time, and new session can continue

ovo iznad je moja preporuka, zato sto cemo imati vise agenata koji su pokrenuti u isto vreme ( claude code opus, claude code fable, claude code gpt 5.6) koji rade research.

agenti ne treba medjusobno da se takmice, treba da saradjuju i da se nadoponjuju i da verifikuju jedan drugog ( npr ako dva agenta potvrde istu stvar ), ali takodje ne treba da verifikuju istu stvar namerno ( znaci da oba agenta testiraju istu stvar da bi videla da je tacno, nego ako se slucajno desi)

takodje zato sto ovde radimo samo na jednoj strategiji mnogo je bitno da ono sto ulazi u memoriju bude tačno, znaci ako neko upise pogresno predpostavku ta ideja ce biti odbacena zauvek, a mozda samo nije dobro zakljucio i to moze da izazuve da preskocim profitablne stvari zato sto su naznacene da ne rade, ovo je jako bitna komponenta zato sto ovaj protokol zamishljam da drzim mesecima upaljen i da se samo unapredjuje. zato sto se trziste non stop menja mora da bude i adaptivno, to znaci da nesto sto nije radilo ranije ne znaci da nece raditi u buducnosti ili slicno.

Trebas sam da smislis i organizujes sistem za memoriju koji najvise odgovara meni i ovome sto pravim.

## Evaluators
na tebi ostavljam da smislis ceo sistem za evaluaciju backtesta, stages, da li ces imati holdout, walk forward, kako ces da biras champions koje metrike ce za evaluaciju da koristi, sta su bitne metrike za ovu strategiju.

Takodje mozda ne bi bilo lose da napravi neku tvoju mernu jedinicu za poredjenje npr:
- koliko je ulozeno ukuno para po market
- koliko je ulozeno ukuno para po market vs profit ( i ratio mozda ) i tako slicne stvari jel onda lakse mozes da uporedjes jel radimo samo na jedno strateziji.

### Mission Control
Ranije kada sam pravio protocole koji rade autonomno danima bilo mi je jako tesko da pratim progress i sta se zapravo desava.

Ovog puta bi hteo da gradis mission controll od samog pocetka, mozes i prvo njega da zapocnes - tako da mogu da udjem u njega i da vidim sta se zaravo desava ( na cemu radis, dokle si stigao itd...) umesto da sedim i chekam samo...

sta je poenta mission control

poenta je da mogu da pratim sta moje autonomne skripte rade ( u obe faze i explore-and-build i research od samog pocetka)

sta hocu da pratim/opcije da imam:
- start i stop ( ovo mozda nije obavezno, ali ako je lako implementirati sto da ne, treba da moze da se odabere: claude code ili codex, pa onda model ( fable 5, opus 5, gpt 5.6 pa cemo dodavati nove kako izlaze)), takodje mozda treba da se odabere koliko turns da uradi ( npr 5, 10, 20, 100) i mozda i koji effort da primeni ( prosli put kada sam radio ovu prvu fazu koristio sam max ili ultracode, ti mi sam preporuci sta mislis da treba za koju fazu i kako i koliko turns itd... mozda moze i sam da ako mu treba jos turn da zatrazi ili slicno)
- u kojoj je trenutno fazi ( explore-and-build or research )
- koliko turns je uradio u kojoj fazi
- za svaki turn koliko je tokena potrosio ( usage and api price ekvivalentno)
- log/updates/notifications
    da u mission control mogu da vidim sta radi u svakom turn-u, human readable, da bi mogao jednostavno da pratim sta se desava i sta radi itd... U jednom turn-u on obicno uradi dosta stvari, tako da u samom jednom turnu mogu da imam vise log/updates/notifications. Primer zapoceo je da radi X, Zavrsio X sada analizira ovo, sada analizra ono itd... Ne mora da bude detaljno toliko ali treba da bude human readble znaci za mene a ne za AI, ai treba za sebe da napravi sistem a ovo je za mene - da ja mogu da pratim sta se desava. Sve ovo za sada je dovoljno da bude u mission control samo sam ga nazvao log/updates/notifikacija da bi lakse skapirao. Takodje mozes da im npr dodelis razlicite tagove ili razlicite files tako da imam razlicite log/update/notifications (primer ako je research ima research tag, ako je protocol upadte - ima taj tag, ako je research protocola, tool building, lupam ovde ovo su mozda bas glupi nego sam samo hteo da ti dam primer )
- Interactive System
    Znači, ovo je samo predlog, moja ideja, i pokušaću da ti objasnim šta želim. Kada bude sistem radio, on će otkrivati stvari tipa: - bug u engine-u, - sugestija kako da se unapredi engine, - sugestija da, ako dodamo ovo, možemo da radimo ono, - sugestija da rubrics nije dobar ili da se dodaju još neki rubrics, - ili da dodamo, ne znam, constraints, - ili da, kako da se ubrza sistem ili kako manje tokena da trošimo. Znači, bilo koja interakcija između AI-a i mene gde, na primer, on daje predlog šta treba. Ja, i to zapisuje, pretpostavljam, to. Ovo je samo takođe moj predlog. On zapisuje to u fajl, i onda ja posle, kroz Mission Control ili kroz editor, mogu da otvorim to, da mu, ne znam, promenim status, i on će pri sledećem turnu da uradi taj zadatak. E, ne znam, ovo je samo moja ideja, zato što mi je loše da on beleži sve bugove koje je našao, sugestije i tako dalje. Ne želim ovo da uopšte komplikuješ. Ovo može i da bude jednostavno, i mislim da treba da bude i jednostavno za početak. Eto, to je pitanje: da li ću ga koristiti i koliko ću ga koristiti. Ali da stvari koje on nalazi ne budu zaboravljene, nego da se tu nalaze i da mogu da ih, ono, referenciram, da mu kažem da popravi i tako dalje. Razmisli o ideji, ne komplikuj ga previše i smisli da li mi je ovo potrebno i kako bismo ovo mogli da implementiramo.
- inbox/steering
    neki način da ako mi padne neka ideja ili hocu nesto da testira ili ako vidim da ide u pogresnom smeru da mogu da ga preusmerim ili da mu kazem, pa on moze u sledecm turn to da primeni, znaci neki nacin da mogu da komuniciram sa njim, odnosno da ga usmeravam. ( ovo mozda moze da bude zajedno sa Interactive System)
- self upgrade
    Ovaj Mission Control bi trebalo da se self-update-uje. Znači, kako gradimo nove feature itd., obratiti pažnju da li treba nešto od toga da dodamo i u Mission Control da se prati.

## Kraj misije / spremnost za research
Ova misija traje koliko treba — nema rok — ali ima jasan cilj: SPREMNOST za
research fazu. Spreman si kada mozes ceo research loop da odradis
end-to-end bez nepoznanica: osmisliti varijantu → pokrenuti backtest preko
fleet-a → procitati i uporediti rezultate → zapisati u memoriju — i kada
postoje tools, memory sistem, mission control v1 i tvoj predlog kako tim
radi.

Kada procenis da si spreman, napisi READY report: sta je isporuceno, sta je
ostalo nepoznato/rizicno, i zasto mislis da je research spreman da krene.
Ja pregledam, prodiskutujemo, i ja aktiviram misiju 02.

Svaki turn treba da te priblizava spremnosti — ako se vrtis u mestu, zapisi
sta te blokira i predlozi resenje umesto da nastavljas.

## Motivation
I build entire Polymarket-bot (complete Trading Infrastructure) da bi ti imao sve alate koji su ti potrebni da bi mogao da napravis ovo sto od tebe trazim. Autonomnog Strategy research koji pravi profitabilne strategije i adaptira se vremenom. Bukvalno imas sve alate koji i drugi imaju, krenuo sam da pravim i distributed backtesting ( fleet ) da bi sve ishlo brze, kada budes dokazao da je strategija profitabilna ( zaradim pare od nje kad je pustim na live) krenucu da kupujem jos mac mini i da povecavam fleet. Tako da ovo treba da bude long term project a ne short term.

Zasto ne mozemo da izgubimo, zato sto sam ti dao sve alate koji su ti potrebni da bi mogao da napravis ono sto od tebe trazim, sada je samo do tebe da nadjes pravu kombinaciju sta radi sta ne radi i da konačno posle 9 meseci napornog rada krenemo masovno da profitiramo.

Znaci da ponovi, samo je do tebe. Vec postoje slični botovi koji rade ovo, zaradjuju dosta para, ako su oni uspeli da naprave ovo, onda i ti mozes da napravis 100% i to ne samo 100% nego i da radi mnogo bolje od toga, jel sigurno niko od njih nije napravio sve ovo sto ja imam. I am the best and i am the winner and winners takes all. Tako da po to smo došli da pobedimo. Nema izgovora, nema predaje, nema odustajanja samo pobeda dolazi u obzir i ništra drugo.

Sada je sve na tebi, ja sam dao sve od sebe da napravim ovo, preuzmi, vodi, bori se, pobedi.