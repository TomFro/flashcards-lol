// Raretés des cartes LoL Master.
// Établies d'après la présence en compétition (LCK, LEC, LPL, Worlds), la popularité en partie classée
// (émeraude et plus) et la puissance / l'importance de chaque sort, objet ou rune.
// Ce qui n'est pas listé prend une rareté par défaut (voir master.js). Modifie librement.
window.MASTER_RARITY = {
  champ: {
    mythic: "LeeSin Azir Ahri Yasuo Thresh",
    legendary: "Orianna Sylas Yone Kaisa Ezreal Jinx Viego Zed Kalista Rakan Nautilus KSante Jax Taliyah Aurora Varus Yunara Zaahen",
    epic: "Akali Aphelios Alistar Ambessa Braum Caitlyn Camille Corki Draven Gnar Gragas Graves Hwei Irelia Jayce JarvanIV Jhin Karma Kayn Khazix Kindred Leblanc Lucian Lux Maokai Nidalee Poppy Rell Renekton Riven Rumble Sejuani Senna Smolder Syndra Vayne Vi Viktor Xayah XinZhao Zeri Ashe MissFortune Darius Renata Skarner Leona Malphite",
    rare: "Aatrox Akshan Annie AurelionSol Bard Belveth Blitzcrank Brand Briar Cassiopeia Diana Ekko Elise Evelynn Fiora Fizz Galio Gangplank Garen Gwen Hecarim Katarina Kennen Kled Lillia Lissandra Lulu MasterYi Mel Milio Mordekaiser Morgana Nami Neeko Nilah Ornn Pantheon Pyke Qiyana Samira Sett Shen Sivir Talon Tristana Twitch TwistedFate Udyr Vex Vladimir Volibear MonkeyKing Yuumi Zac Zilean Zyra Seraphine Soraka Swain Naafiri Shaco Kassadin",
  },
  // Sorts : id du champion + touche (P, Q, W, E, R)
  spell: {
    mythic: "LeeSin_R Azir_R Orianna_R Thresh_Q Malphite_R Yasuo_R",
    legendary: "Amumu_R Galio_R Shen_R TwistedFate_R Zed_R Ashe_R Kalista_R Sejuani_R Rell_R Jinx_R Ezreal_R Karthus_R Soraka_R Kindred_R Zilean_R Bard_R Taric_R Blitzcrank_Q Nautilus_R Fiddlesticks_R Ornn_R Kennen_R Leona_R Lux_R Sylas_R Viego_P Pyke_R Annie_R Jhin_R Draven_Q Kaisa_P Ahri_R Rakan_W Alistar_W Gragas_E Vi_R Malzahar_R Wukong_R MonkeyKing_R Gangplank_R Janna_R Lissandra_R Seraphine_R Nami_R Sona_R Varus_R Xerath_R Yone_R Ksante_R KSante_R Tryndamere_R Kayle_R Zac_E Hecarim_R",
    epic: "Akali_R Akali_W Ahri_E Annie_P Brand_P Braum_E Caitlyn_W Camille_R Diana_R Ekko_R Elise_E Evelynn_R Ezreal_Q Fiora_R Fizz_R Garen_R Gnar_R Gwen_W Irelia_E Jax_E Jayce_R Kassadin_R Katarina_R Kayn_R Khazix_P LeeSin_Q Leblanc_W Lucian_E Lulu_W Lulu_R MasterYi_Q Mordekaiser_R Morgana_E Morgana_Q Nidalee_Q Olaf_R Poppy_E Rammus_Q Renekton_W Riven_Q Samira_R Sett_R Singed_Q Sion_R Swain_R Syndra_R Talon_R Teemo_R Thresh_W Tristana_E Twitch_Q Vayne_Q Vayne_E Veigar_E Velkoz_R Viktor_W Vladimir_W Warwick_R Xayah_R Yuumi_P Zed_W Zyra_R",
  },
  // Objets : identifiants Data Dragon
  item: {
    mythic: "3031 3089",
    legendary: "6672 3078 3153 3157 6653 3036 3071 3026 3135 6655 3087 3124 3115 3742 3065 3190 3161",
    epic: "3072 3046 3085 3094 3033 3091 3100 3165 3116 3102 4645 3003 3040 3004 3053 6333 3074 3748 3075 3143 3110 3068 2504 3107 3222 3504 6617 2065 3142 6694 6676 3814 6610 6631 3181 3118 2503 3137 3302 3032 3020 3006 3047 3111",
  },
  // Runes : clé Data Dragon
  rune: {
    mythic: "Conqueror",
    legendary: "Electrocute LethalTempo ArcaneComet GraspOfTheUndying FirstStrike SummonAery",
    epic: "PressTheAttack FleetFootwork PhaseRush DarkHarvest HailOfBlades GlacialAugment Guardian UnsealedSpellbook VeteranAftershock Flash",
    rare: "Triumph LegendAlacrity LegendHaste CoupDeGrace LastStand PresenceOfMind Overgrowth SecondWind BonePlating Conditioning Revitalize TasteOfBlood SuddenImpact CheapShot TreasureHunter UltimateHunter Transcendence GatheringStorm Scorch ManaflowBand AbsoluteFocus BiscuitDelivery MagicalFootwear CosmicInsight TimeWarpTonic CutDown",
  },
};
