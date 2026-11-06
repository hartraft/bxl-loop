// Brussels-Capital Region postal plate labels. Unknown OSM names are intentionally left blank.
const normalizePlace = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const DISTRICT_INFO = new Map(Object.entries({
  // Brussels-Capital Region: neighbourhoods and commune names commonly found in OSM.
  'Brussels': ['1000', 'City of Brussels'], 'City of Brussels': ['1000', 'City of Brussels'],
  'Pentagon': ['1000', 'City of Brussels'], 'Marolles': ['1000', 'City of Brussels'], 'Sablon': ['1000', 'City of Brussels'],
  'Dansaert': ['1000', 'City of Brussels'], 'Sainte-Catherine': ['1000', 'City of Brussels'], 'Sint-Katelijne': ['1000', 'City of Brussels'],
  'Laeken': ['1020', 'City of Brussels'], 'Laken': ['1020', 'City of Brussels'],
  'Neder-Over-Heembeek': ['1120', 'City of Brussels'],
  'Haren': ['1130', 'City of Brussels'],
  'Schaerbeek': ['1030', 'Schaerbeek'], 'Schaarbeek': ['1030', 'Schaerbeek'], 'Helmet': ['1030', 'Schaerbeek'],
  'Josaphat': ['1030', 'Schaerbeek'], 'Plasky': ['1030', 'Schaerbeek'], 'Dailly': ['1030', 'Schaerbeek'],
  'Etterbeek': ['1040', 'Etterbeek'], 'Jourdan': ['1040', 'Etterbeek'], 'Cinquantenaire': ['1040', 'Etterbeek'],
  'Ixelles': ['1050', 'Ixelles'], 'Elsene': ['1050', 'Ixelles'], 'Flagey': ['1050', 'Ixelles'], 'Matonge': ['1050', 'Ixelles'], 'Châtelain': ['1050', 'Ixelles'], 'Chatelain': ['1050', 'Ixelles'],
  'Saint-Gilles': ['1060', 'Saint-Gilles'], 'Sint-Gillis': ['1060', 'Saint-Gilles'], 'Parvis de Saint-Gilles': ['1060', 'Saint-Gilles'],
  'Anderlecht': ['1070', 'Anderlecht'],
  'Molenbeek-Saint-Jean': ['1080', 'Molenbeek-Saint-Jean'], 'Sint-Jans-Molenbeek': ['1080', 'Molenbeek-Saint-Jean'],
  'Koekelberg': ['1081', 'Koekelberg'], 'Berchem-Sainte-Agathe': ['1082', 'Berchem-Sainte-Agathe'],
  'Sint-Agatha-Berchem': ['1082', 'Berchem-Sainte-Agathe'], 'Ganshoren': ['1083', 'Ganshoren'], 'Jette': ['1090', 'Jette'],
  'Evere': ['1140', 'Evere'], 'Woluwe-Saint-Pierre': ['1150', 'Woluwe-Saint-Pierre'],
  'Sint-Pieters-Woluwe': ['1150', 'Woluwe-Saint-Pierre'], 'Auderghem': ['1160', 'Auderghem'],
  'Oudergem': ['1160', 'Auderghem'], 'Watermael-Boitsfort': ['1170', 'Watermael-Boitsfort'],
  'Watermaal-Bosvoorde': ['1170', 'Watermael-Boitsfort'], 'Uccle': ['1180', 'Uccle'], 'Forest': ['1190', 'Forest'],
  'Vorst': ['1190', 'Forest'], 'Woluwe-Saint-Lambert': ['1200', 'Woluwe-Saint-Lambert'],
  'Sint-Lambrechts-Woluwe': ['1200', 'Woluwe-Saint-Lambert'], 'Saint-Josse-ten-Noode': ['1210', 'Saint-Josse-ten-Noode'],
  'Sint-Joost-ten-Node': ['1210', 'Saint-Josse-ten-Noode']
}).map(([name, value]) => [normalizePlace(name), value]));

/** { postcode, borough } for a known Brussels neighbourhood/commune; unknown names stay unlabelled. */
export function postcodeFor(district) {
  const value = district && DISTRICT_INFO.get(normalizePlace(district));
  return value ? { postcode: value[0], borough: value[1] } : { postcode: '', borough: '' };
}

