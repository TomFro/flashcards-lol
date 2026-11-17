// Joueurs pro de LoL Master : les cartes les plus rares du jeu (bien plus rares que les skins).
//
// Effectifs 2026 des équipes : effectifs des Worlds 2026 pour les équipes qualifiées, et pour les autres
// le dernier effectif connu de la saison 2026 (changements de mi-saison compris).
// Sources : esports.net (effectifs de janvier 2026), Sheep Esports (changements LEC avant l'été, échanges
// d'ADC en LCK, retour de TheShy chez IG), GosuGamers (effectifs des Worlds 2026), BLG championne du monde 2026.
//
// Rareté d'un joueur = le parcours de son équipe en 2026 :
//   Mythique   : champions du monde 2026 (Bilibili Gaming), et Faker
//   Légendaire : équipes LCK et LPL qualifiées aux Worlds 2026
//   Épique     : autres équipes qualifiées aux Worlds 2026 (LEC, LCS, LCP, CBLOL)
//   Rare       : équipes LCK et LPL pas qualifiées aux Worlds
//   Commune    : équipes LEC et LCS pas qualifiées aux Worlds
//
// Pour ajouter ou corriger un joueur : modifie la liste de son équipe (ordre Top, Jungle, Mid, ADC, Support ;
// un remplaçant s'écrit ["Pseudo", "poste"]). L'identifiant d'une carte vient du pseudo : changer le pseudo
// d'un joueur déjà tiré fait perdre sa carte à ceux qui l'ont.
// worlds : "champion" | "finale" | "worlds" | absent (pas qualifiée)
window.MASTER_PROS = {
  updated: "17 novembre 2026, après la finale des Worlds",
  // pour forcer une rareté à la main : { p_faker: "mythic" }
  override: { p_faker: "mythic" },
  why: { p_faker: "La légende du jeu, champion du monde avec T1" },
  teams: [
    // ---------- LCK (Corée) ----------
    { tag: "GEN", name: "Gen.G", league: "LCK", c: ["#aa8a00", "#1b1b1b"], worlds: "finale", players: ["Kiin", "Canyon", "Chovy", "Ruler", "Duro"] },
    { tag: "HLE", name: "Hanwha Life Esports", league: "LCK", c: ["#f37321", "#1b1b1b"], worlds: "worlds", players: ["Zeus", "Kanavi", "Zeka", "Gumayusi", "Delight"] },
    { tag: "T1", name: "T1", league: "LCK", c: ["#e2012d", "#140306"], worlds: "worlds", players: ["Doran", "Oner", "Faker", "Peyz", "Keria"] },
    { tag: "DK", name: "Dplus KIA", league: "LCK", c: ["#25c3b0", "#0d1a24"], worlds: "worlds", players: ["Siwoo", "Lucid", "ShowMaker", "Smash", "Career"] },
    { tag: "KT", name: "KT Rolster", league: "LCK", c: ["#e4002b", "#1a1a1a"], players: ["PerfecT", "Cuzz", "Bdd", "Jiwoo", "Ghost"] },
    { tag: "BFX", name: "BNK FEARX", league: "LCK", c: ["#ffc20e", "#1d1d1b"], players: ["Clear", "Raptor", "VicLa", "Taeyoon", "Kellin"] },
    { tag: "NS", name: "Nongshim RedForce", league: "LCK", c: ["#de2027", "#1a0606"], players: ["Kingen", "Sponge", "Scout", "Diable", "Lehens"] },
    { tag: "BRO", name: "Hanjin BRION", league: "LCK", c: ["#00704a", "#06150f"], players: ["Casting", "GIDEON", "Fisher", "Teddy", "Namgung"] },
    { tag: "KRX", name: "Kiwoom DRX", league: "LCK", c: ["#5a8dee", "#0a1430"], players: ["Rich", "Vincenzo", "ucal", "Aiming", "Andil", ["LazyFeel", "adc"]] },
    { tag: "DNF", name: "DN Freecs", league: "LCK", c: ["#e73828", "#1c0b08"], players: ["DuDu", "Pyosik", "Clozer", "deokdam", "Peter"] },

    // ---------- LPL (Chine) ----------
    { tag: "BLG", name: "Bilibili Gaming", league: "LPL", c: ["#00a1d6", "#061a26"], worlds: "champion", players: ["Bin", "Xun", "Knight", "Viper", "ON"] },
    { tag: "AL", name: "Anyone's Legend", league: "LPL", c: ["#c8102e", "#1a0509"], worlds: "worlds", players: ["Breathe", "Tarzan", "Shanks", "Hope", "Kael"] },
    { tag: "TES", name: "Top Esports", league: "LPL", c: ["#ff3d00", "#1a0a04"], worlds: "worlds", players: ["ZUIAN", "Tian", "Creme", "JackeyLove", "Zhuo", ["369", "top"]] },
    { tag: "IG", name: "Invictus Gaming", league: "LPL", c: ["#c9a14a", "#111111"], worlds: "worlds", players: ["TheShy", "Wei", "Rookie", "JiaQi", "Meiko"] },
    { tag: "JDG", name: "JD Gaming", league: "LPL", c: ["#d71920", "#170506"], players: ["Xiaoxu", "JunJia", "HongQ", "GALA", "Vampire"] },
    { tag: "WBG", name: "Weibo Gaming", league: "LPL", c: ["#f5a623", "#1a1205"], players: ["Zika", "Jiejie", "Xiaohu", "Elk", "Erha"] },
    { tag: "LNG", name: "LNG Esports", league: "LPL", c: ["#00a0e9", "#04131c"], players: ["sheer", "Croco", "BullDoG", "1xn", "Missing"] },
    { tag: "EDG", name: "EDward Gaming", league: "LPL", c: ["#9a9a9a", "#101010"], players: ["Zdz", "Xiaohao", "Angel", "Leave", "Parukia"] },
    { tag: "NIP", name: "Ninjas in Pyjamas", league: "LPL", c: ["#c7c7c7", "#0e0e0e"], players: ["HOYA", "Guwon", "Care", "Assum"] },
    { tag: "OMG", name: "Oh My God", league: "LPL", c: ["#ff6a13", "#1a0c04"], players: ["Hery", "Juhan", "haichao", "Starry", "Moham"] },
    { tag: "WE", name: "Team WE", league: "LPL", c: ["#e60033", "#17040a"], players: ["Cube", "Monki", "Karis", "About", "yaoyao"] },
    { tag: "TT", name: "ThunderTalk Gaming", league: "LPL", c: ["#f8d000", "#1a1600"], players: ["Keshi", "Junhao", "Heru", "Ryan3", "Feather"] },
    { tag: "UP", name: "Ultra Prime", league: "LPL", c: ["#7b4dff", "#0f0a20"], players: ["Liangchen", "Grizzly", "Saber", "Hena", "Xiaoxia"] },
    { tag: "LGD", name: "LGD Gaming", league: "LPL", c: ["#d4a017", "#141008"], players: ["sasi", "Heng", "Tangyuan", "Shaoye", "ycx"] },

    // ---------- LEC (Europe) ----------
    { tag: "G2", name: "G2 Esports", league: "LEC", c: ["#ed1c24", "#111111"], worlds: "worlds", players: ["BrokenBlade", "SkewMond", "Caps", "Hans Sama", "Labrov"] },
    { tag: "MKOI", name: "Movistar KOI", league: "LEC", c: ["#00a9e0", "#04141c"], worlds: "worlds", players: ["Myrwn", "Elyoya", "Jojopyun", "Supa", "Alvaro"] },
    { tag: "KC", name: "Karmine Corp", league: "LEC", c: ["#00b2ff", "#08162e"], worlds: "worlds", players: ["Canna", "Yike", "Kyeahoo", "Caliste", "Busio"] },
    { tag: "FNC", name: "Fnatic", league: "LEC", c: ["#ff5900", "#1a0b03"], players: ["Soboro", "Razork", "Vladi", "Upset", "Lospa"] },
    { tag: "GX", name: "GIANTX", league: "LEC", c: ["#e10600", "#150303"], players: ["Oscarinin", "ISMA", "Jackies", "Flakked", "Jun"] },
    { tag: "VIT", name: "Team Vitality", league: "LEC", c: ["#ffe600", "#161400"], players: ["Naak Nako", "Lyncas", "FIESTA", "Carzzy", "Fleshy"] },
    { tag: "TH", name: "Team Heretics", league: "LEC", c: ["#c8a24a", "#121008"], players: ["Tracyn", "Daglas", "Serin", "Hype", "Way"] },
    { tag: "SHFT", name: "Shifters", league: "LEC", c: ["#7dd3fc", "#07141c"], players: ["Rooster", "Sheo", "nuc", "Paduck", "Stend"] },
    { tag: "SK", name: "SK Gaming", league: "LEC", c: ["#9ca3af", "#0d0f12"], players: ["Wunder", "Skeanz", "SlowQ", "Jopa", "Mikyx"] },
    { tag: "NAVI", name: "Natus Vincere", league: "LEC", c: ["#ffee00", "#141400"], players: ["Maynter", "Rhilech", "Poby", "SamD", "Parus"] },

    // ---------- LCS (Amérique du Nord) ----------
    { tag: "TL", name: "Team Liquid", league: "LCS", c: ["#2b6ea6", "#07121c"], worlds: "worlds", players: ["Morgan", "Josedeodo", "Quid", "Yeon", "CoreJJ"] },
    { tag: "LYON", name: "LYON", league: "LCS", c: ["#e4b400", "#151100"], worlds: "worlds", players: ["Dhokla", "Inspired", "Saint", "Berserker", "Isles"] },
    { tag: "C9", name: "Cloud9", league: "LCS", c: ["#1fb5ff", "#05121a"], worlds: "worlds", players: ["Thanatos", "Blaber", "Loki", "Tactical", "Vulcan"] },
    { tag: "FLY", name: "FlyQuest", league: "LCS", c: ["#1c8a4a", "#04140b"], players: ["Gakgos", "Gryffinn", "Quad", "Massu", "Cryogen"] },
    { tag: "SR", name: "Shopify Rebellion", league: "LCS", c: ["#95bf47", "#0d1405"], players: ["Fudge", "Contractz", "Zinie", "Bvoy", "Ceos"] },
    { tag: "SEN", name: "Sentinels", league: "LCS", c: ["#ce0037", "#170309"], players: ["Impact", "HamBak", "DARKWINGS", "Rahel", "Huhi"] },
    { tag: "DIG", name: "Dignitas", league: "LCS", c: ["#f5c400", "#151100"], players: ["Photon", "eXyu", "Palafox", "FBI", "IgNar"] },
    { tag: "DSG", name: "Disguised", league: "LCS", c: ["#9b5de5", "#100a18"], players: ["Castle", "KryRa", "Calime", "Sajed", "Lyonz"] },

    // ---------- autres ligues qualifiées aux Worlds 2026 ----------
    { tag: "TSW", name: "Team Secret Whales", league: "LCP", c: ["#e0e0e0", "#101010"], worlds: "worlds", players: ["Pun", "Hizto", "Dire", "Eddie", "Bie"] },
    { tag: "CFO", name: "CTBC Flying Oyster", league: "LCP", c: ["#00a6a6", "#031616"], worlds: "worlds", players: ["Rest", "Shad0w", "Pout", "Doggo", "Kino"] },
    { tag: "MVK", name: "MVK Esports", league: "LCP", c: ["#ff8c00", "#1a0e00"], worlds: "worlds", players: ["Kratos", "Gury", "Chika", "Harky", "SiuLoong"] },
    { tag: "LOS", name: "LOS", league: "CBLOL", c: ["#ff2d55", "#1a050a"], worlds: "worlds", players: ["ZEST", "Curse", "Feisty", "Duduhh", "Ackerman"] },
    { tag: "FUR", name: "FURIA Esports", league: "CBLOL", c: ["#d9d9d9", "#0d0d0d"], worlds: "worlds", players: ["Guigo", "Tatu", "Tutsz", "Ayu", "Jojo"] },
  ],
};
