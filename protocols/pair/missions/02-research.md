# Mission 02: Autonomus Strategy Research Loop

Ovo je Autonomna Research Lab koja treba da radi 24/7 i da za pair strategiju.
da radi research, daje predloge, pokrece eksperimente, cita iz baze, zapisuje u memoriju, unapredjuje sistem, unapredjuje strategiju.


## GOAL

### Build profitable strategy
This is number one priority. As soon as possible.
there is 96 markets per day for 15 min btc.
If EV per total markets is 2$ i will earn 192$ per day only from btc 15 min (at $3 = $288), then we can optimize it, scale it and so on. But it would be realy nice if we can produce first strategy that generate at has EV 2$ per total markets i would be happy with it. Also it will be much simpler for me to run it in live trading - because it's less capital to start with.

Znam da je mozda ovakve strategije lakse napraviti kada se radi sa vise kapitala, tako da trebalo bi da testira oba u isto vreme, jel sve jedno kad budem prebacio na live prvo bi poceo sa manje kapitala da bi testirao dal sve radi i koliko su verni backtest vs live ( parrity ) pa bi onda pocavao budget.

### Capital / Size metrics
EV po marketu bez kapitala ne znaci nista: $2 EV sa $50 uloga po marketu je
odlicna strategija, sa $5000 je losa — a simulator nema cash limit, pa ulog
moze neprimetno da raste. Smisli sam merne jedinice koje rezultate cine
uporedivim (npr. ulozeno po marketu, profit per $100 ulozeno, EV na vise
nivoa kapitala) i prijavljuj ih uz svaki rezultat. Live krecem sa malim
kapitalom pa povecavam — zato meri i na malom i na velikom.

### Multiple independent strategies
Pair strategija moze da se napravi na 10, 20, 100 nacina. "B je slabiji od A"
nije razlog da se B odbaci: ako su A i B nezavisni jedan od drugog i oba
profitabilna, mogu da rade paralelno i oba zaradjuju. Znaci ne trazimo samo
jednog najboljeg — gradimo portfolio nezavisnih nacina koji ne smetaju jedan
drugom. Ti smisli kako se meri da li su dva nacina zaista nezavisna, kako ih
posteno poredis, i kada ima smisla drzati vise njih umesto jednog.

### Strategies self improve forever
Jednom kada se nadje profitabilna strategija, istrazi se koliko je scalabilna itd i kada se zavrsi to nema razlog da se stane. Strategija sigurno jos uvek moze da se unapredi ( a da nebude overfit ). Takodje trziste se menja tako i strategija treba da se menja.
Kada kazem improve forever mislim da non stop trazi nove nacine, testira, verifikuje, pronalazi kako da je unapredi itd... nema razloga da stane, sigurno ima bezbroj kobinacija koje mogu da rade.

### Strategy Self Adopt To market Changes
Nekad je bull run, nekad je bear run, nekad nema trades, nekad ih ima previse, nije poenta da se samo napravi strageija, nego da se gradi baza znanja ( memory ) koji ce posle pomoci da strategija lako moze da prezivi razlicite rezime, da se adaptira na promene, da moze da se prilagodi, a ne da radi samo na jednom rezimu.

Ovo ne mora od samog pocetka, za pocetak mi je dovoljno da zaraduje > $2-3 per EV total markets da bih mogao da je pokrenem na live i da zaradujem i da imam novac, a posle dugorocno ovo bi bilo lepo da ima.

## Suggestions
### Smart Token Usage
Npr u proslom sistemu sam radio da uvek pokrece jedan po jedan eksperiment i da na osnovu njega donosi sledecu odluku ( ovo sam ja dizajnirao ), ali sam u medjuvremnu shvatio da je to je to preveliki token burn, jel pokrecem celu sesiju i ucitavam gomilu context-a (ceo protocol, eksperimente, itd...) da bi na kraju napravio samo jedan eksperiment, kad vec sa tim sto ima u sessiji ima dovoljno znanja da pokrene umesto jedan experiment vise njih. Koliko je to vise njih i kako ce da functionise to ostavljam tebi da odlučiš, ovo je samo primer iz moje proslosti koji sam imao pa reko da razmishljas i o tome dok dizajniras sistem

### Self check system
Treba da napravis system koji ce na svakih par turnova da pogleda sta radi sistem i da pogleda da nije skrenuo sa misije/goal na neke nebitne stvari i sitinice.