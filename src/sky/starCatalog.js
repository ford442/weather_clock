/**
 * A deliberately small bright-star catalog plus stylized constellation stick
 * figures. Roughly every star down to magnitude ~3.5 that a constellation
 * figure needs, which is enough for the night sky to read as the real sky
 * without shipping a planetarium database (the whole file is a few KB gzipped).
 *
 * Positions are J2000 equinox: right ascension in hours, declination in
 * degrees. `bv` is the B–V colour index, used to tint the star (negative = blue
 * white, positive = orange/red); it defaults to a near-white 0.3 when omitted.
 *
 * Constellation `lines` reference star ids and are simplified figures, not
 * IAU boundaries.
 *
 * @typedef {{id: string, name: string, raHours: number, decDeg: number, mag: number, bv: number}} CatalogStar
 * @typedef {{abbr: string, name: string, lines: [string, string][]}} Constellation
 */

/** @type {[string, string, number, number, number, number?][]} */
const STAR_ROWS = [
    // Ursa Major
    ['dubhe', 'Dubhe', 11.0622, 61.751, 1.79, 1.07],
    ['merak', 'Merak', 11.0307, 56.382, 2.37, 0.03],
    ['phecda', 'Phecda', 11.8972, 53.695, 2.44, 0.04],
    ['megrez', 'Megrez', 12.2571, 57.033, 3.31, 0.08],
    ['alioth', 'Alioth', 12.9005, 55.96, 1.77, -0.02],
    ['mizar', 'Mizar', 13.3987, 54.925, 2.23, 0.02],
    ['alkaid', 'Alkaid', 13.7923, 49.313, 1.86, -0.19],
    // Ursa Minor
    ['polaris', 'Polaris', 2.5303, 89.264, 1.98, 0.6],
    ['kochab', 'Kochab', 14.845, 74.156, 2.08, 1.47],
    ['pherkad', 'Pherkad', 15.3455, 71.834, 3.05, 0.09],
    ['yildun', 'Yildun', 17.5369, 86.586, 4.36, 0.02],
    ['eps-umi', 'Epsilon Ursae Minoris', 16.766, 82.037, 4.23, 0.89],
    ['zeta-umi', 'Zeta Ursae Minoris', 15.7346, 77.794, 4.32, 0.04],
    ['eta-umi', 'Eta Ursae Minoris', 16.2917, 75.755, 4.95, 0.36],
    // Orion
    ['betelgeuse', 'Betelgeuse', 5.9195, 7.407, 0.45, 1.85],
    ['rigel', 'Rigel', 5.2423, -8.202, 0.18, -0.03],
    ['bellatrix', 'Bellatrix', 5.4185, 6.35, 1.64, -0.22],
    ['mintaka', 'Mintaka', 5.5334, -0.299, 2.23, -0.18],
    ['alnilam', 'Alnilam', 5.6036, -1.202, 1.69, -0.18],
    ['alnitak', 'Alnitak', 5.6793, -1.943, 1.77, -0.2],
    ['saiph', 'Saiph', 5.7959, -9.67, 2.06, -0.17],
    // Canis Major / Minor
    ['sirius', 'Sirius', 6.7525, -16.716, -1.46, 0.0],
    ['mirzam', 'Mirzam', 6.3783, -17.956, 1.98, -0.24],
    ['wezen', 'Wezen', 7.1399, -26.393, 1.83, 0.67],
    ['adhara', 'Adhara', 6.9771, -28.972, 1.5, -0.21],
    ['aludra', 'Aludra', 7.4016, -29.303, 2.45, -0.08],
    ['procyon', 'Procyon', 7.655, 5.225, 0.34, 0.42],
    ['gomeisa', 'Gomeisa', 7.4529, 8.289, 2.89, -0.09],
    // Taurus
    ['aldebaran', 'Aldebaran', 4.5987, 16.509, 0.87, 1.54],
    ['elnath', 'Elnath', 5.4382, 28.608, 1.65, -0.13],
    ['zeta-tau', 'Zeta Tauri', 5.6273, 21.143, 3.0, -0.15],
    ['gamma-tau', 'Gamma Tauri', 4.3299, 15.628, 3.65, 0.98],
    ['eps-tau', 'Epsilon Tauri', 4.4767, 19.18, 3.53, 1.01],
    ['alcyone', 'Alcyone', 3.7914, 24.105, 2.87, -0.09],
    // Gemini
    ['pollux', 'Pollux', 7.7553, 28.026, 1.14, 1.0],
    ['castor', 'Castor', 7.5767, 31.888, 1.58, 0.03],
    ['alhena', 'Alhena', 6.6285, 16.399, 1.9, 0.0],
    ['mu-gem', 'Mu Geminorum', 6.3828, 22.514, 2.87, 1.64],
    ['eps-gem', 'Mebsuta', 6.732, 25.131, 2.98, 1.4],
    // Auriga
    ['capella', 'Capella', 5.2782, 45.998, 0.08, 0.8],
    ['menkalinan', 'Menkalinan', 5.9921, 44.947, 1.9, 0.08],
    ['theta-aur', 'Theta Aurigae', 5.9953, 37.213, 2.62, -0.08],
    ['iota-aur', 'Iota Aurigae', 4.9497, 33.166, 2.69, 1.53],
    // Leo
    ['regulus', 'Regulus', 10.1395, 11.967, 1.36, -0.11],
    ['denebola', 'Denebola', 11.8177, 14.572, 2.14, 0.09],
    ['algieba', 'Algieba', 10.3329, 19.841, 2.08, 1.13],
    ['zosma', 'Zosma', 11.2351, 20.524, 2.56, 0.13],
    ['eps-leo', 'Epsilon Leonis', 9.7644, 23.774, 2.98, 0.8],
    ['theta-leo', 'Chertan', 11.2372, 15.43, 3.33, 0.0],
    ['zeta-leo', 'Adhafera', 10.2782, 23.417, 3.44, 0.31],
    ['eta-leo', 'Eta Leonis', 10.1222, 16.763, 3.48, -0.03],
    // Virgo
    ['spica', 'Spica', 13.4199, -11.161, 0.98, -0.23],
    ['vindemiatrix', 'Vindemiatrix', 13.0362, 10.959, 2.83, 0.94],
    ['gamma-vir', 'Porrima', 12.6943, -1.449, 2.74, 0.36],
    ['zeta-vir', 'Heze', 13.5786, -0.596, 3.38, 0.11],
    // Bootes
    ['arcturus', 'Arcturus', 14.261, 19.182, -0.05, 1.23],
    ['eps-boo', 'Izar', 14.7498, 27.074, 2.35, 0.97],
    ['eta-boo', 'Muphrid', 13.9114, 18.398, 2.68, 0.58],
    ['gamma-boo', 'Seginus', 14.5346, 38.308, 3.03, 0.19],
    ['beta-boo', 'Nekkar', 15.0322, 40.39, 3.49, 0.97],
    ['delta-boo', 'Delta Bootis', 15.2582, 33.315, 3.47, 0.95],
    // Cygnus
    ['deneb', 'Deneb', 20.6905, 45.28, 1.25, 0.09],
    ['albireo', 'Albireo', 19.5121, 27.96, 3.05, 1.09],
    ['sadr', 'Sadr', 20.3705, 40.257, 2.23, 0.68],
    ['gienah-cyg', 'Gienah', 20.7702, 33.97, 2.48, 1.03],
    ['delta-cyg', 'Delta Cygni', 19.7496, 45.131, 2.87, -0.03],
    // Lyra
    ['vega', 'Vega', 18.6156, 38.784, 0.03, 0.0],
    ['zeta-lyr', 'Zeta Lyrae', 18.7464, 37.605, 4.36, 0.19],
    ['beta-lyr', 'Sheliak', 18.8347, 33.363, 3.45, 0.0],
    ['gamma-lyr', 'Sulafat', 18.9824, 32.69, 3.24, -0.05],
    ['delta-lyr', 'Delta Lyrae', 18.9081, 36.899, 4.3, 1.68],
    // Aquila
    ['altair', 'Altair', 19.8464, 8.868, 0.76, 0.22],
    ['tarazed', 'Tarazed', 19.771, 10.613, 2.72, 1.52],
    ['beta-aql', 'Alshain', 19.9211, 6.407, 3.71, 0.86],
    ['zeta-aql', 'Okab', 19.0904, 13.864, 2.99, 0.01],
    ['theta-aql', 'Theta Aquilae', 20.1882, -0.821, 3.23, -0.07],
    // Scorpius
    ['antares', 'Antares', 16.4901, -26.432, 1.06, 1.83],
    ['graffias', 'Graffias', 16.0906, -19.805, 2.62, -0.07],
    ['delta-sco', 'Dschubba', 16.0055, -22.622, 2.29, -0.12],
    ['pi-sco', 'Pi Scorpii', 15.9811, -26.114, 2.89, -0.19],
    ['sigma-sco', 'Alniyat', 16.3536, -25.593, 2.89, 0.13],
    ['tau-sco', 'Tau Scorpii', 16.5981, -28.216, 2.82, -0.25],
    ['eps-sco', 'Larawag', 16.8361, -34.293, 2.29, 1.14],
    ['mu-sco', 'Mu Scorpii', 16.8654, -38.048, 3.08, -0.2],
    ['shaula', 'Shaula', 17.5601, -37.104, 1.62, -0.22],
    ['upsilon-sco', 'Lesath', 17.5127, -37.296, 2.69, -0.22],
    ['theta-sco', 'Sargas', 17.6221, -42.998, 1.87, 0.4],
    ['kappa-sco', 'Girtab', 17.7081, -39.03, 2.39, -0.22],
    ['iota-sco', 'Iota Scorpii', 17.7933, -40.127, 3.03, 0.51],
    // Sagittarius
    ['kaus-australis', 'Kaus Australis', 18.4029, -34.385, 1.85, -0.03],
    ['nunki', 'Nunki', 18.9211, -26.297, 2.05, -0.22],
    ['kaus-media', 'Kaus Media', 18.3499, -29.828, 2.7, 1.38],
    ['kaus-borealis', 'Kaus Borealis', 18.4664, -25.422, 2.81, 1.02],
    ['ascella', 'Ascella', 19.0435, -29.88, 2.6, 0.06],
    ['phi-sgr', 'Phi Sagittarii', 18.7609, -26.991, 3.17, -0.11],
    ['tau-sgr', 'Tau Sagittarii', 19.1152, -27.67, 3.32, 1.17],
    ['gamma-sgr', 'Alnasl', 18.0966, -30.424, 2.98, 1.0],
    // Cassiopeia
    ['schedar', 'Schedar', 0.6751, 56.537, 2.24, 1.17],
    ['caph', 'Caph', 0.1529, 59.15, 2.28, 0.34],
    ['gamma-cas', 'Gamma Cassiopeiae', 0.9451, 60.717, 2.47, -0.15],
    ['ruchbah', 'Ruchbah', 1.4303, 60.235, 2.68, 0.13],
    ['segin', 'Segin', 1.9067, 63.67, 3.35, -0.15],
    // Perseus
    ['mirfak', 'Mirfak', 3.4054, 49.861, 1.79, 0.48],
    ['algol', 'Algol', 3.1362, 40.956, 2.12, -0.05],
    ['gamma-per', 'Gamma Persei', 3.0799, 53.507, 2.93, 0.7],
    ['delta-per', 'Delta Persei', 3.7154, 47.788, 3.01, -0.13],
    ['eps-per', 'Epsilon Persei', 3.9643, 40.01, 2.9, -0.18],
    ['zeta-per', 'Zeta Persei', 3.9024, 31.884, 2.85, 0.12],
    // Andromeda
    ['alpheratz', 'Alpheratz', 0.1398, 29.091, 2.06, -0.11],
    ['mirach', 'Mirach', 1.1622, 35.621, 2.06, 1.58],
    ['almach', 'Almach', 2.065, 42.33, 2.1, 1.37],
    ['delta-and', 'Delta Andromedae', 0.6553, 30.861, 3.27, 1.28],
    // Pegasus
    ['markab', 'Markab', 23.0795, 15.205, 2.48, -0.04],
    ['scheat', 'Scheat', 23.0629, 28.083, 2.42, 1.67],
    ['algenib', 'Algenib', 0.2206, 15.184, 2.83, -0.19],
    ['enif', 'Enif', 21.7364, 9.875, 2.39, 1.52],
    ['eta-peg', 'Matar', 22.7169, 30.221, 2.93, 0.86],
    ['zeta-peg', 'Homam', 22.691, 10.832, 3.4, -0.09],
    ['theta-peg', 'Biham', 22.1699, 6.198, 3.52, 0.09],
    // Cepheus
    ['alderamin', 'Alderamin', 21.3096, 62.586, 2.45, 0.22],
    ['alfirk', 'Alfirk', 21.4776, 70.561, 3.23, -0.22],
    ['gamma-cep', 'Errai', 23.6557, 77.632, 3.21, 1.03],
    ['delta-cep', 'Delta Cephei', 22.4869, 58.415, 4.07, 0.66],
    ['zeta-cep', 'Zeta Cephei', 22.1811, 58.201, 3.35, 1.56],
    // Draco
    ['thuban', 'Thuban', 14.0732, 64.376, 3.65, -0.05],
    ['beta-dra', 'Rastaban', 17.5072, 52.301, 2.79, 0.95],
    ['eltanin', 'Eltanin', 17.9434, 51.489, 2.23, 1.52],
    ['xi-dra', 'Grumium', 17.8917, 56.873, 3.75, 1.18],
    ['delta-dra', 'Altais', 19.2093, 67.661, 3.07, 1.0],
    ['zeta-dra', 'Aldhibah', 17.1465, 65.715, 3.17, -0.12],
    ['eta-dra', 'Athebyne', 16.3999, 61.514, 2.73, 0.91],
    ['iota-dra', 'Edasich', 15.4155, 58.966, 3.29, 1.16],
    // Crux
    ['acrux', 'Acrux', 12.4433, -63.099, 0.77, -0.24],
    ['mimosa', 'Mimosa', 12.7953, -59.689, 1.25, -0.24],
    ['gacrux', 'Gacrux', 12.5194, -57.113, 1.59, 1.59],
    ['delta-cru', 'Imai', 12.2525, -58.749, 2.79, -0.19],
    // Centaurus
    ['rigil-kentaurus', 'Rigil Kentaurus', 14.6601, -60.835, -0.27, 0.71],
    ['hadar', 'Hadar', 14.0637, -60.373, 0.61, -0.23],
    ['theta-cen', 'Menkent', 14.1114, -36.37, 2.06, 1.01],
    ['eps-cen', 'Epsilon Centauri', 13.6648, -53.466, 2.3, -0.22],
    ['eta-cen', 'Eta Centauri', 14.5917, -42.158, 2.31, -0.19],
    // Carina
    ['canopus', 'Canopus', 6.3992, -52.696, -0.74, 0.15],
    ['miaplacidus', 'Miaplacidus', 9.22, -69.717, 1.67, 0.07],
    ['avior', 'Avior', 8.3752, -59.51, 1.86, 1.19],
    ['iota-car', 'Aspidiske', 9.285, -59.275, 2.21, 0.18],
    // Vela
    ['gamma-vel', 'Regor', 8.1586, -47.337, 1.75, -0.15],
    ['delta-vel', 'Alsephina', 8.745, -54.709, 1.96, 0.04],
    ['lambda-vel', 'Suhail', 9.1333, -43.433, 2.21, 1.67],
    ['kappa-vel', 'Markeb', 9.3683, -55.011, 2.47, -0.18],
    // Cetus
    ['menkar', 'Menkar', 3.038, 4.09, 2.53, 1.63],
    ['diphda', 'Diphda', 0.7265, -17.987, 2.04, 1.02],
    ['gamma-cet', 'Kaffaljidhma', 2.7215, 3.236, 3.47, 0.09],
    ['mira', 'Mira', 2.3224, -2.977, 3.0, 1.42],
    // Corvus
    ['gienah-crv', 'Gienah Corvi', 12.2634, -17.542, 2.59, -0.11],
    ['beta-crv', 'Kraz', 12.5735, -23.397, 2.65, 0.89],
    ['delta-crv', 'Algorab', 12.4979, -16.515, 2.95, -0.05],
    ['eps-crv', 'Minkar', 12.1685, -22.62, 3.02, 1.33],
    // Corona Borealis
    ['alphecca', 'Alphecca', 15.5781, 26.715, 2.22, -0.02],
    ['beta-crb', 'Nusakan', 15.4638, 29.106, 3.66, 0.28],
    ['gamma-crb', 'Gamma Coronae Borealis', 15.7118, 26.296, 3.84, 0.03],
    ['theta-crb', 'Theta Coronae Borealis', 15.5483, 31.359, 4.14, -0.13],
    ['delta-crb', 'Delta Coronae Borealis', 15.8265, 26.068, 4.63, 0.8],
    ['eps-crb', 'Epsilon Coronae Borealis', 15.9599, 26.878, 4.15, 1.23],
    // Hercules
    ['rasalgethi', 'Rasalgethi', 17.2443, 14.39, 3.1, 1.44],
    ['beta-her', 'Kornephoros', 16.5036, 21.49, 2.77, 0.94],
    ['zeta-her', 'Zeta Herculis', 16.6882, 31.603, 2.81, 0.65],
    ['eps-her', 'Epsilon Herculis', 17.0047, 30.926, 3.92, 0.0],
    ['pi-her', 'Pi Herculis', 17.2504, 36.809, 3.16, 1.44],
    ['eta-her', 'Eta Herculis', 16.7147, 38.922, 3.53, 0.92],
    ['delta-her', 'Sarin', 17.2504, 24.839, 3.12, 0.08],
    // Ophiuchus
    ['rasalhague', 'Rasalhague', 17.5822, 12.56, 2.08, 0.16],
    ['eta-oph', 'Sabik', 17.1729, -15.725, 2.43, 0.06],
    ['zeta-oph', 'Zeta Ophiuchi', 16.6194, -10.567, 2.56, 0.02],
    ['delta-oph', 'Yed Prior', 16.2391, -3.694, 2.73, 1.58],
    ['beta-oph', 'Cebalrai', 17.7243, 4.567, 2.76, 1.16],
    // Aries
    ['hamal', 'Hamal', 2.1195, 23.462, 2.0, 1.15],
    ['sheratan', 'Sheratan', 1.9105, 20.808, 2.64, 0.17],
    ['gamma-ari', 'Mesarthim', 1.8925, 19.294, 3.86, 0.02],
    // Cancer
    ['beta-cnc', 'Altarf', 8.2753, 9.186, 3.52, 1.48],
    ['delta-cnc', 'Asellus Australis', 8.7449, 18.154, 3.94, 1.08],
    ['gamma-cnc', 'Asellus Borealis', 8.7215, 21.469, 4.66, 0.01],
    ['alpha-cnc', 'Acubens', 8.9747, 11.858, 4.25, 0.14],
    // Libra
    ['zubenelgenubi', 'Zubenelgenubi', 14.8479, -16.042, 2.75, 0.15],
    ['zubeneschamali', 'Zubeneschamali', 15.2833, -9.383, 2.61, -0.11],
    ['gamma-lib', 'Gamma Librae', 15.5919, -14.789, 3.91, 1.01],
    ['sigma-lib', 'Brachium', 15.0679, -25.282, 3.29, 1.7],
    // Capricornus
    ['alpha-cap', 'Algedi', 20.3019, -12.545, 3.57, 0.91],
    ['beta-cap', 'Dabih', 20.35, -14.781, 3.05, 0.79],
    ['delta-cap', 'Deneb Algedi', 21.784, -16.127, 2.85, 0.18],
    ['gamma-cap', 'Nashira', 21.6684, -16.662, 3.68, 0.32],
    ['zeta-cap', 'Zeta Capricorni', 21.4449, -22.411, 3.74, 1.0],
    ['omega-cap', 'Omega Capricorni', 20.8637, -26.919, 4.11, 1.63],
    // Aquarius
    ['sadalsuud', 'Sadalsuud', 21.526, -5.571, 2.9, 0.83],
    ['sadalmelik', 'Sadalmelik', 22.0964, -0.32, 2.95, 0.98],
    ['skat', 'Skat', 22.9109, -15.821, 3.27, 0.05],
    ['gamma-aqr', 'Sadachbia', 22.3615, -1.387, 3.84, 0.05],
    ['zeta-aqr', 'Zeta Aquarii', 22.4804, -0.02, 3.65, 0.4],
    ['lambda-aqr', 'Lambda Aquarii', 22.8767, -7.58, 3.74, 1.64],
    // Pisces
    ['eta-psc', 'Alpherg', 1.5249, 15.346, 3.62, 0.97],
    ['gamma-psc', 'Gamma Piscium', 23.2866, 3.282, 3.69, 0.92],
    ['omega-psc', 'Omega Piscium', 23.9887, 6.863, 4.01, 0.42],
    ['alpha-psc', 'Alrescha', 2.0334, 2.764, 3.82, 0.03],
    // Bright loners that anchor the sky without a figure
    ['achernar', 'Achernar', 1.6286, -57.237, 0.45, -0.16],
    ['fomalhaut', 'Fomalhaut', 22.9608, -29.622, 1.16, 0.09],
    ['alphard', 'Alphard', 9.4599, -8.659, 1.98, 1.44],
    ['beta-eri', 'Cursa', 5.1305, -5.086, 2.78, 0.13]
];

/** @type {CatalogStar[]} */
export const STARS = STAR_ROWS.map(([id, name, raHours, decDeg, mag, bv]) => ({
    id,
    name,
    raHours,
    decDeg,
    mag,
    bv: bv ?? 0.3
}));

/** Fast id → index lookup into {@link STARS}. */
export const STAR_INDEX = new Map(STARS.map((star, index) => [star.id, index]));

/** @type {Constellation[]} */
export const CONSTELLATIONS = [
    {
        abbr: 'UMa',
        name: 'Ursa Major',
        lines: [
            ['dubhe', 'merak'],
            ['merak', 'phecda'],
            ['phecda', 'megrez'],
            ['megrez', 'dubhe'],
            ['megrez', 'alioth'],
            ['alioth', 'mizar'],
            ['mizar', 'alkaid']
        ]
    },
    {
        abbr: 'UMi',
        name: 'Ursa Minor',
        lines: [
            ['polaris', 'yildun'],
            ['yildun', 'eps-umi'],
            ['eps-umi', 'zeta-umi'],
            ['zeta-umi', 'kochab'],
            ['kochab', 'pherkad'],
            ['pherkad', 'eta-umi'],
            ['eta-umi', 'zeta-umi']
        ]
    },
    {
        abbr: 'Ori',
        name: 'Orion',
        lines: [
            ['betelgeuse', 'bellatrix'],
            ['bellatrix', 'mintaka'],
            ['mintaka', 'alnilam'],
            ['alnilam', 'alnitak'],
            ['alnitak', 'betelgeuse'],
            ['mintaka', 'rigel'],
            ['alnitak', 'saiph'],
            ['rigel', 'saiph']
        ]
    },
    {
        abbr: 'CMa',
        name: 'Canis Major',
        lines: [
            ['mirzam', 'sirius'],
            ['sirius', 'wezen'],
            ['wezen', 'adhara'],
            ['wezen', 'aludra']
        ]
    },
    { abbr: 'CMi', name: 'Canis Minor', lines: [['procyon', 'gomeisa']] },
    {
        abbr: 'Tau',
        name: 'Taurus',
        lines: [
            ['gamma-tau', 'aldebaran'],
            ['aldebaran', 'zeta-tau'],
            ['gamma-tau', 'eps-tau'],
            ['eps-tau', 'elnath']
        ]
    },
    {
        abbr: 'Gem',
        name: 'Gemini',
        lines: [
            ['castor', 'pollux'],
            ['castor', 'eps-gem'],
            ['eps-gem', 'mu-gem'],
            ['pollux', 'alhena']
        ]
    },
    {
        abbr: 'Aur',
        name: 'Auriga',
        lines: [
            ['capella', 'menkalinan'],
            ['menkalinan', 'theta-aur'],
            ['theta-aur', 'elnath'],
            ['elnath', 'iota-aur'],
            ['iota-aur', 'capella']
        ]
    },
    {
        abbr: 'Leo',
        name: 'Leo',
        lines: [
            ['regulus', 'eta-leo'],
            ['eta-leo', 'algieba'],
            ['algieba', 'zeta-leo'],
            ['zeta-leo', 'eps-leo'],
            ['regulus', 'theta-leo'],
            ['theta-leo', 'denebola'],
            ['denebola', 'zosma'],
            ['zosma', 'algieba'],
            ['theta-leo', 'zosma']
        ]
    },
    {
        abbr: 'Vir',
        name: 'Virgo',
        lines: [
            ['spica', 'zeta-vir'],
            ['zeta-vir', 'gamma-vir'],
            ['gamma-vir', 'vindemiatrix']
        ]
    },
    {
        abbr: 'Boo',
        name: 'Bootes',
        lines: [
            ['arcturus', 'eps-boo'],
            ['eps-boo', 'delta-boo'],
            ['delta-boo', 'beta-boo'],
            ['beta-boo', 'gamma-boo'],
            ['gamma-boo', 'arcturus'],
            ['arcturus', 'eta-boo']
        ]
    },
    {
        abbr: 'Cyg',
        name: 'Cygnus',
        lines: [
            ['deneb', 'sadr'],
            ['sadr', 'albireo'],
            ['delta-cyg', 'sadr'],
            ['sadr', 'gienah-cyg']
        ]
    },
    {
        abbr: 'Lyr',
        name: 'Lyra',
        lines: [
            ['vega', 'zeta-lyr'],
            ['zeta-lyr', 'beta-lyr'],
            ['beta-lyr', 'gamma-lyr'],
            ['gamma-lyr', 'delta-lyr'],
            ['delta-lyr', 'zeta-lyr']
        ]
    },
    {
        abbr: 'Aql',
        name: 'Aquila',
        lines: [
            ['zeta-aql', 'tarazed'],
            ['tarazed', 'altair'],
            ['altair', 'beta-aql'],
            ['beta-aql', 'theta-aql']
        ]
    },
    {
        abbr: 'Sco',
        name: 'Scorpius',
        lines: [
            ['graffias', 'delta-sco'],
            ['delta-sco', 'pi-sco'],
            ['delta-sco', 'sigma-sco'],
            ['sigma-sco', 'antares'],
            ['antares', 'tau-sco'],
            ['tau-sco', 'eps-sco'],
            ['eps-sco', 'mu-sco'],
            ['mu-sco', 'theta-sco'],
            ['theta-sco', 'iota-sco'],
            ['iota-sco', 'kappa-sco'],
            ['kappa-sco', 'upsilon-sco'],
            ['upsilon-sco', 'shaula']
        ]
    },
    {
        abbr: 'Sgr',
        name: 'Sagittarius',
        lines: [
            ['gamma-sgr', 'kaus-media'],
            ['kaus-media', 'kaus-australis'],
            ['kaus-australis', 'ascella'],
            ['ascella', 'tau-sgr'],
            ['tau-sgr', 'nunki'],
            ['nunki', 'phi-sgr'],
            ['phi-sgr', 'ascella'],
            ['phi-sgr', 'kaus-borealis'],
            ['kaus-borealis', 'kaus-media']
        ]
    },
    {
        abbr: 'Cas',
        name: 'Cassiopeia',
        lines: [
            ['caph', 'schedar'],
            ['schedar', 'gamma-cas'],
            ['gamma-cas', 'ruchbah'],
            ['ruchbah', 'segin']
        ]
    },
    {
        abbr: 'Per',
        name: 'Perseus',
        lines: [
            ['gamma-per', 'mirfak'],
            ['mirfak', 'delta-per'],
            ['delta-per', 'eps-per'],
            ['eps-per', 'zeta-per'],
            ['mirfak', 'algol']
        ]
    },
    {
        abbr: 'And',
        name: 'Andromeda',
        lines: [
            ['alpheratz', 'delta-and'],
            ['delta-and', 'mirach'],
            ['mirach', 'almach']
        ]
    },
    {
        abbr: 'Peg',
        name: 'Pegasus',
        lines: [
            ['alpheratz', 'algenib'],
            ['algenib', 'markab'],
            ['markab', 'scheat'],
            ['scheat', 'alpheratz'],
            ['markab', 'zeta-peg'],
            ['zeta-peg', 'theta-peg'],
            ['theta-peg', 'enif'],
            ['scheat', 'eta-peg']
        ]
    },
    {
        abbr: 'Cep',
        name: 'Cepheus',
        lines: [
            ['alderamin', 'alfirk'],
            ['alfirk', 'gamma-cep'],
            ['alderamin', 'zeta-cep'],
            ['zeta-cep', 'delta-cep']
        ]
    },
    {
        abbr: 'Dra',
        name: 'Draco',
        lines: [
            ['eltanin', 'beta-dra'],
            ['beta-dra', 'xi-dra'],
            ['xi-dra', 'eltanin'],
            ['xi-dra', 'delta-dra'],
            ['delta-dra', 'zeta-dra'],
            ['zeta-dra', 'eta-dra'],
            ['eta-dra', 'iota-dra'],
            ['iota-dra', 'thuban']
        ]
    },
    {
        abbr: 'Cru',
        name: 'Crux',
        lines: [
            ['acrux', 'gacrux'],
            ['mimosa', 'delta-cru']
        ]
    },
    {
        abbr: 'Cen',
        name: 'Centaurus',
        lines: [
            ['rigil-kentaurus', 'hadar'],
            ['hadar', 'eps-cen'],
            ['rigil-kentaurus', 'eta-cen'],
            ['eta-cen', 'theta-cen']
        ]
    },
    {
        abbr: 'Car',
        name: 'Carina',
        lines: [
            ['canopus', 'avior'],
            ['avior', 'iota-car'],
            ['iota-car', 'miaplacidus']
        ]
    },
    {
        abbr: 'Vel',
        name: 'Vela',
        lines: [
            ['gamma-vel', 'delta-vel'],
            ['delta-vel', 'kappa-vel'],
            ['kappa-vel', 'lambda-vel'],
            ['lambda-vel', 'gamma-vel']
        ]
    },
    {
        abbr: 'Cet',
        name: 'Cetus',
        lines: [
            ['menkar', 'gamma-cet'],
            ['gamma-cet', 'mira'],
            ['mira', 'diphda']
        ]
    },
    {
        abbr: 'Crv',
        name: 'Corvus',
        lines: [
            ['eps-crv', 'gienah-crv'],
            ['gienah-crv', 'delta-crv'],
            ['delta-crv', 'beta-crv'],
            ['beta-crv', 'eps-crv']
        ]
    },
    {
        abbr: 'CrB',
        name: 'Corona Borealis',
        lines: [
            ['theta-crb', 'beta-crb'],
            ['beta-crb', 'alphecca'],
            ['alphecca', 'gamma-crb'],
            ['gamma-crb', 'delta-crb'],
            ['delta-crb', 'eps-crb']
        ]
    },
    {
        abbr: 'Her',
        name: 'Hercules',
        lines: [
            ['zeta-her', 'eps-her'],
            ['eps-her', 'pi-her'],
            ['pi-her', 'eta-her'],
            ['eta-her', 'zeta-her'],
            ['zeta-her', 'beta-her'],
            ['beta-her', 'rasalgethi'],
            ['eps-her', 'delta-her'],
            ['delta-her', 'rasalgethi']
        ]
    },
    {
        abbr: 'Oph',
        name: 'Ophiuchus',
        lines: [
            ['rasalhague', 'delta-oph'],
            ['delta-oph', 'zeta-oph'],
            ['zeta-oph', 'eta-oph'],
            ['rasalhague', 'beta-oph'],
            ['beta-oph', 'eta-oph']
        ]
    },
    {
        abbr: 'Ari',
        name: 'Aries',
        lines: [
            ['hamal', 'sheratan'],
            ['sheratan', 'gamma-ari']
        ]
    },
    {
        abbr: 'Cnc',
        name: 'Cancer',
        lines: [
            ['beta-cnc', 'delta-cnc'],
            ['delta-cnc', 'gamma-cnc'],
            ['delta-cnc', 'alpha-cnc']
        ]
    },
    {
        abbr: 'Lib',
        name: 'Libra',
        lines: [
            ['zubenelgenubi', 'zubeneschamali'],
            ['zubeneschamali', 'gamma-lib'],
            ['gamma-lib', 'zubenelgenubi'],
            ['zubenelgenubi', 'sigma-lib']
        ]
    },
    {
        abbr: 'Cap',
        name: 'Capricornus',
        lines: [
            ['alpha-cap', 'beta-cap'],
            ['beta-cap', 'omega-cap'],
            ['omega-cap', 'zeta-cap'],
            ['zeta-cap', 'gamma-cap'],
            ['gamma-cap', 'delta-cap'],
            ['delta-cap', 'alpha-cap']
        ]
    },
    {
        abbr: 'Aqr',
        name: 'Aquarius',
        lines: [
            ['sadalsuud', 'sadalmelik'],
            ['sadalmelik', 'gamma-aqr'],
            ['gamma-aqr', 'zeta-aqr'],
            ['sadalmelik', 'lambda-aqr'],
            ['lambda-aqr', 'skat']
        ]
    },
    {
        abbr: 'Psc',
        name: 'Pisces',
        lines: [
            ['gamma-psc', 'omega-psc'],
            ['omega-psc', 'eta-psc'],
            ['eta-psc', 'alpha-psc']
        ]
    }
];

/**
 * Flat list of [startIndex, endIndex] pairs into {@link STARS}, ready to fill a
 * LineSegments position buffer. Unknown ids are dropped rather than throwing so
 * a typo in a figure can never blank the whole sky.
 * @returns {number[]}
 */
export function getConstellationLineIndices() {
    /** @type {number[]} */
    const indices = [];
    for (const constellation of CONSTELLATIONS) {
        for (const [fromId, toId] of constellation.lines) {
            const from = STAR_INDEX.get(fromId);
            const to = STAR_INDEX.get(toId);
            if (from === undefined || to === undefined) continue;
            indices.push(from, to);
        }
    }
    return indices;
}

/**
 * Approximate RGB for a star's B–V colour index, normalised so the brightest
 * channel is 1. Keeps Betelgeuse orange and Rigel blue-white without a
 * blackbody lookup table.
 * @param {number} bv
 * @returns {[number, number, number]}
 */
export function colorFromBV(bv) {
    const clamped = Math.max(-0.4, Math.min(2.0, bv));
    // Piecewise-linear fit through the usual B–V → RGB anchor points.
    const r = clamped < 0 ? 0.75 + clamped * 0.25 : Math.min(1, 0.75 + clamped * 0.3);
    const g = clamped < 0 ? 0.85 + clamped * 0.1 : Math.max(0.55, 0.9 - clamped * 0.18);
    const b = clamped < 0 ? 1 : Math.max(0.4, 1 - clamped * 0.42);
    const peak = Math.max(r, g, b) || 1;
    return [r / peak, g / peak, b / peak];
}
