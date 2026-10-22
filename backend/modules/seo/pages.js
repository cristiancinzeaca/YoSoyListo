// Páginas públicas para Google: preguntas con respuestas por categoría (/preguntas y /preguntas/:cat).
// Se generan en el servidor a partir de db/questions/*.json, sin JavaScript (las respuestas van en <details>).
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', '..', 'db', 'questions');

const CATS = {
  general: {
    name: 'Cultura general',
    title: 'Preguntas de cultura general con respuestas',
    desc: 'Preguntas de cultura general con respuestas: fáciles, medias y difíciles. Pon a prueba lo que sabes y juega gratis contra otros jugadores.',
    intro:
      'Aquí tienes preguntas de cultura general con sus respuestas: costumbres, animales, idiomas, marcas, fiestas, números y curiosidades del día a día. Las hemos ordenado de más fáciles a más difíciles para que puedas usarlas en un trivial con amigos, en clase o para repasar. Toca «Ver respuesta» para comprobar si has acertado.',
  },
  historia: {
    name: 'Historia',
    title: 'Preguntas de historia con respuestas',
    desc: 'Preguntas de historia de España y del mundo con respuestas: de la Antigüedad a nuestros días. Juega gratis y demuestra cuánto sabes.',
    intro:
      'Preguntas de historia con respuestas, de la Antigüedad a nuestros días: Roma y Grecia, la Edad Media, la historia de España, las guerras mundiales y los grandes personajes. Son perfectas para repasar antes de un examen o para retar a tu familia. Toca «Ver respuesta» para comprobar si has acertado.',
  },
  geografia: {
    name: 'Geografía',
    title: 'Preguntas de geografía con respuestas',
    desc: 'Preguntas de geografía con respuestas: capitales, ríos, montañas, países y comunidades de España. Juega gratis a conquistar el mapa.',
    intro:
      'Preguntas de geografía con respuestas: capitales del mundo, ríos, montañas, monumentos famosos y las comunidades y provincias de España. Empiezan por las más fáciles y terminan con algunas que solo aciertan los más viajeros. Toca «Ver respuesta» para comprobar si has acertado.',
  },
  ciencia: {
    name: 'Ciencia',
    title: 'Preguntas de ciencia con respuestas',
    desc: 'Preguntas de ciencia con respuestas: cuerpo humano, química, física, astronomía, animales y matemáticas. Juega gratis y aprende jugando.',
    intro:
      'Preguntas de ciencia con respuestas sobre el cuerpo humano, la química, la física, el espacio, los animales y las matemáticas. Muchas incluyen una breve explicación para que aprendas algo nuevo aunque falles. Toca «Ver respuesta» para comprobar si has acertado.',
  },
  arte: {
    name: 'Arte y literatura',
    title: 'Preguntas de arte, literatura, cine y música con respuestas',
    desc: 'Preguntas de arte, literatura, cine y música con respuestas: pintores, escritores, películas, series y canciones. Juega gratis.',
    intro:
      'Preguntas de arte, literatura, cine y música con respuestas: pintores y museos, escritores y novelas, películas, series, dibujos animados y grupos míticos. Hay desde preguntas que sabe cualquiera hasta otras para auténticos expertos. Toca «Ver respuesta» para comprobar si has acertado.',
  },
  deportes: {
    name: 'Deportes',
    title: 'Preguntas de deportes con respuestas',
    desc: 'Preguntas de deportes con respuestas: fútbol, baloncesto, tenis, Fórmula 1, Juegos Olímpicos y más. Juega gratis contra otros jugadores.',
    intro:
      'Preguntas de deportes con respuestas: fútbol, baloncesto, tenis, ciclismo, Fórmula 1, motociclismo y Juegos Olímpicos, con especial atención a los deportistas españoles. Toca «Ver respuesta» para comprobar si has acertado.',
  },
};
const ORDER = ['general', 'historia', 'geografia', 'ciencia', 'arte', 'deportes'];

// Páginas por tema (búsquedas concretas). Cada una filtra las preguntas existentes.
const norm = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const has = (re) => (q) => re.test(norm(`${q.text} ${q.correct}`));
// Palabras al principio de palabra (admite plurales); `not` descarta falsos positivos.
const words = (list, not) => {
  const re = new RegExp(`\\b(${list.join('|')})`);
  const no = not ? new RegExp(`\\b(${not.join('|')})`) : null;
  return (q) => {
    const t = norm(`${q.text} ${q.correct}`);
    return re.test(t) && !(no && no.test(t));
  };
};
const inCats = (cats, f = () => true) => (q, cat) => cats.includes(cat) && f(q);
const ESP = /espan|madrid|barcelona|sevilla|valencia|andaluc|castilla|cataluna|galicia|asturias|canarias|baleares|toledo|granada|cordoba|bilbao|zaragoza|pamplona|franco|reyes catolicos|felipe ii|carlos i\b|alfonso|borbon|constitucion de 1978|transicion|laliga|liga espanola|cervantes|velazquez|goya|picasso|dali|lorca|almodovar|paella|tortilla|sanfermin|fallas|teide|ebro|tajo|duero|guadalquivir|pirineos/;
const THEMES = {
  'para-ninos': {
    name: 'Para niños',
    title: 'Preguntas para niños con respuestas',
    desc: 'Preguntas fáciles para niños con respuestas: animales, colores, cuerpo humano, planetas y curiosidades. Ideales para clase o para jugar en familia.',
    intro:
      'Preguntas sencillas para niños y niñas con sus respuestas: animales, colores, números, el cuerpo humano, los planetas y curiosidades del día a día. Son perfectas para jugar en familia, en un cumpleaños o en clase. Lee la pregunta en voz alta, deja que piensen y luego toca «Ver respuesta».',
    filter: inCats(['general', 'ciencia'], (q) => q.difficulty === 1),
  },
  faciles: {
    name: 'Fáciles',
    title: 'Preguntas fáciles de cultura general con respuestas',
    desc: 'Preguntas fáciles de cultura general con respuestas: historia, geografía, arte y deportes para calentar motores. Juega gratis online.',
    intro:
      'Preguntas fáciles de cultura general con respuestas, para empezar un trivial sin que nadie se quede atrás: historia, geografía, arte, cine y deportes. Si las aciertas casi todas, prueba con las difíciles. Toca «Ver respuesta» para comprobar si has acertado.',
    filter: inCats(['historia', 'geografia', 'arte', 'deportes'], (q) => q.difficulty === 1),
  },
  dificiles: {
    name: 'Difíciles',
    title: 'Preguntas difíciles de cultura general con respuestas',
    desc: 'Preguntas difíciles de cultura general con respuestas para expertos: historia, ciencia, geografía, arte y deportes. ¿Cuántas aciertas?',
    intro:
      'Preguntas difíciles de cultura general con respuestas, solo para los más listos: datos de historia, ciencia, geografía, arte y deportes que no sabe casi nadie. Si aciertas más de la mitad, tienes un nivel muy alto. Toca «Ver respuesta» para comprobar si has acertado.',
    filter: (q) => q.difficulty === 3,
  },
  espana: {
    name: 'Sobre España',
    title: 'Preguntas sobre España con respuestas',
    desc: 'Preguntas sobre España con respuestas: historia, geografía, comunidades, costumbres, arte y deportistas españoles. ¿Cuánto sabes de España?',
    intro:
      'Preguntas sobre España con respuestas: su historia, sus comunidades y provincias, ríos y montañas, fiestas y costumbres, pintores y escritores, y sus grandes deportistas. Un repaso perfecto para españoles y para quien quiera conocer mejor el país. Toca «Ver respuesta» para comprobar si has acertado.',
    filter: (q) => ESP.test(norm(`${q.text} ${q.correct}`)),
  },
  'historia-de-espana': {
    name: 'Historia de España',
    title: 'Preguntas de historia de España con respuestas',
    desc: 'Preguntas de historia de España con respuestas: Hispania romana, al-Ándalus, Reyes Católicos, el Imperio, la Guerra Civil y la Transición.',
    intro:
      'Preguntas de historia de España con respuestas: de la Hispania romana y al-Ándalus a los Reyes Católicos, el Imperio, la Guerra de la Independencia, la Guerra Civil y la Transición. Muy útiles para repasar la asignatura. Toca «Ver respuesta» para comprobar si has acertado.',
    filter: inCats(['historia'], (q) => ESP.test(norm(`${q.text} ${q.correct}`)) || /hispania|al-andalus|numancia|covadonga|cid\b|lepanto|trafalgar|pepa|isabel ii|fernando vii|1808|1936|1975|1978|23-f|23 de febrero/.test(norm(`${q.text} ${q.correct}`))),
  },
  capitales: {
    name: 'Capitales',
    title: 'Preguntas de capitales del mundo con respuestas',
    desc: 'Preguntas de capitales del mundo con respuestas: Europa, América, Asia y África. Repasa las capitales jugando.',
    intro:
      'Preguntas sobre capitales del mundo con respuestas: de Europa, América, Asia, África y Oceanía, desde las más conocidas hasta algunas que suelen pillar a todo el mundo. Toca «Ver respuesta» para comprobar si has acertado.',
    filter: inCats(['geografia'], has(/capital/)),
  },
  futbol: {
    name: 'Fútbol',
    title: 'Preguntas de fútbol con respuestas',
    desc: 'Preguntas de fútbol con respuestas: Mundiales, Champions, LaLiga, selección española y grandes jugadores como Messi o Cristiano.',
    intro:
      'Preguntas de fútbol con respuestas: Mundiales, Eurocopas, la Champions, LaLiga, estadios, la selección española y leyendas como Pelé, Maradona, Messi o Cristiano Ronaldo. Toca «Ver respuesta» para comprobar si has acertado.',
    filter: inCats(['deportes'], words(['futbol', 'mundial', 'eurocopa', 'champions', 'liga de campeones', 'laliga', 'liga espanola', 'gol\\b', 'goles', 'estadio', 'balon de oro', 'penalti', 'messi', 'cristiano', 'pele', 'maradona', 'real madrid', 'fc barcelona', 'barca', 'atletico de madrid', 'athletic', 'manchester', 'bayern', 'juventus', 'liverpool', 'camp nou', 'bernabeu', 'var\\b', 'tarjeta roja', 'iniesta', 'putellas', 'haaland', 'mbappe', 'salah', 'albiceleste', 'canarinha', 'old trafford', 'vecchia', 'mano de dios', 'metropolitano', 'villamarin', 'sanchez-pizjuan', 'san mames', 'once jugadores'], ['olimpic', 'baloncesto', 'rugby', 'tenis', 'super bowl', 'futbol americano', 'formula 1', 'piloto', 'motociclismo', 'nba'])),
  },
  animales: {
    name: 'Animales',
    title: 'Preguntas sobre animales con respuestas',
    desc: 'Preguntas sobre animales con respuestas: mamíferos, aves, insectos, crías y curiosidades del reino animal. Para niños y mayores.',
    intro:
      'Preguntas sobre animales con respuestas: cómo se llaman sus crías, qué comen, cuál es el más rápido o el más grande y muchas curiosidades del reino animal. Valen para niños y para mayores. Toca «Ver respuesta» para comprobar si has acertado.',
    filter: inCats(['general', 'ciencia'], words(['animal', 'mamifero', 'aves\\b', 'ave\\b', 'insecto', 'pez\\b', 'peces', 'reptil', 'anfibio', 'cria\\b', 'perro', 'gato', 'leon\\b', 'tigre', 'elefante', 'jirafa', 'ballena', 'delfin', 'tortuga', 'abeja', 'arana', 'pulpo', 'panda', 'koala', 'canguro', 'cebra', 'guepardo', 'pinguino', 'murcielago', 'aguila', 'halcon', 'lince', 'oso\\b', 'vaca', 'caballo', 'yegua', 'potro', 'oveja', 'cerdo', 'camaleon', 'ornitorrinco', 'avestruz', 'camello', 'dromedario', 'gusano', 'mariposa', 'rana\\b', 'lobo', 'zorro', 'cabra', 'conejo', 'gazapo', 'ternero', 'cachorro', 'lechon', 'burro', 'carnero', 'herbivor', 'omnivor', 'carnivor'])),
  },
  'cine-y-series': {
    name: 'Cine y series',
    title: 'Preguntas de cine y series con respuestas',
    desc: 'Preguntas de cine y series con respuestas: Disney, Pixar, Marvel, Star Wars, Harry Potter, directores, actores y series famosas.',
    intro:
      'Preguntas de cine y series con respuestas: películas de Disney y Pixar, superhéroes de Marvel y DC, sagas como Star Wars o Harry Potter, directores y actores españoles y series que todo el mundo ha visto. Toca «Ver respuesta» para comprobar si has acertado.',
    filter: inCats(['arte'], words(['pelicula', 'serie\\b', 'series\\b', 'actor', 'actriz', 'director', 'dirigio', 'disney', 'pixar', 'marvel', 'superheroe', 'star wars', 'harry potter', 'hogwarts', 'gandalf', 'oscar', 'premios goya', 'los goya', 'cine\\b', 'simpson', 'toy story', 'shrek', 'netflix', 'james bond', 'batman', 'spider', 'superman', 'hulk', 'thor\\b', 'iron man', 'jack sparrow', 'titanic', 'el padrino', 'studio ghibli', 'juego de tronos', 'la casa de papel', 'breaking bad', 'el juego del calamar', 'dibujos animados', 'mickey', 'el rey leon', 'cenicienta', 'sirenita', 'elsa\\b', 'bugs bunny', 'olaf', 'woody', 'buzz', 'parque jurasico', 'indiana jones', 'darth vader', 'piratas del caribe', 'bollywood', 'que la fuerza'])),
  },
  musica: {
    name: 'Música',
    title: 'Preguntas de música con respuestas',
    desc: 'Preguntas de música con respuestas: grupos, cantantes, compositores clásicos, instrumentos y estilos musicales. Juega gratis.',
    intro:
      'Preguntas de música con respuestas: grupos y cantantes míticos, estrellas actuales, compositores clásicos, ópera, instrumentos y estilos como el jazz, el reggae o el flamenco. Toca «Ver respuesta» para comprobar si has acertado.',
    filter: inCats(['arte'], words(['cancion', 'canciones', 'cantante', 'canto\\b', 'grupo', 'compuso', 'compositor', 'sinfonia', 'opera\\b', 'instrumento', 'guitarra', 'piano', 'violin', 'teclas', 'cuerdas', 'musica', 'musical', 'jazz', 'reggae', 'tango', 'samba', 'flamenco', 'sevillanas', 'beatles', 'queen\\b', 'abba', 'rock', 'pop\\b', 'bob marley', 'shakira', 'rosalia', 'adele', 'taylor swift', 'mozart', 'beethoven', 'vivaldi', 'chaikovski', 'verdi', 'ravel', 'manuel de falla', 'joaquin rodrigo', 'tenor\\b', 'soprano', 'notas', 'elvis', 'michael jackson', 'jimi hendrix', 'placido domingo', 'montserrat caballe', 'eurovision'], ['poema', 'escribio', 'pelicula'])),
  },
  literatura: {
    name: 'Literatura',
    title: 'Preguntas de literatura con respuestas',
    desc: 'Preguntas de literatura con respuestas: El Quijote, García Lorca, Shakespeare, novelas famosas, poetas y escritores españoles.',
    intro:
      'Preguntas de literatura con respuestas: del Quijote y el Siglo de Oro a la Generación del 27, Shakespeare, los grandes novelistas rusos, la literatura hispanoamericana y los libros juveniles más famosos. Toca «Ver respuesta» para comprobar si has acertado.',
    filter: inCats(['arte'], words(['escribio', 'escritor', 'novela', 'libro', 'poeta', 'poema', 'autor', 'obra de teatro', 'cuento', 'quijote', 'cervantes', 'lorca', 'machado', 'becquer', 'shakespeare', 'tolkien', 'rowling', 'lazarillo', 'celestina', 'cantar de mio cid', 'dulcinea', 'rocinante', 'sherlock', 'poirot', 'dracula', 'frankenstein', 'principito', 'homero', 'iliada', 'odisea', 'dante', 'garcia marquez', 'neruda', 'borges', 'delibes', 'galdos', 'unamuno', 'quevedo', 'lope de vega', 'calderon', 'zorrilla', 'generacion del'], ['pelicula', 'harry potter', 'hogwarts', 'gandalf'])),
  },
  'cuerpo-humano': {
    name: 'Cuerpo humano',
    title: 'Preguntas sobre el cuerpo humano con respuestas',
    desc: 'Preguntas sobre el cuerpo humano con respuestas: huesos, órganos, sangre, músculos, sentidos y vitaminas. Aprende jugando.',
    intro:
      'Preguntas sobre el cuerpo humano con respuestas: cuántos huesos tenemos, cuál es el órgano más grande, para qué sirve cada parte del cuerpo, la sangre, los músculos, los sentidos y las vitaminas. Toca «Ver respuesta» para comprobar si has acertado.',
    filter: inCats(['ciencia'], words(['cuerpo', 'hueso', 'organo', 'sangre', 'musculo', 'diente', 'vitamina', 'corazon', 'pulmon', 'higado', 'rinon', 'cerebro', 'cerebelo', 'piel\\b', 'ojo\\b', 'iris\\b', 'oido', 'olfato', 'sentido', 'cromosoma', 'plaquetas', 'globulos', 'aorta', 'femur', 'pancreas', 'alveolo', 'escorbuto', 'calcio', 'glute', 'respira', 'bombea', 'craneo', 'bilis'], ['simbolo quimico', 'energia'])),
  },
  espacio: {
    name: 'El espacio',
    title: 'Preguntas sobre el espacio y los planetas con respuestas',
    desc: 'Preguntas sobre el espacio con respuestas: planetas, el Sol, la Luna, estrellas, galaxias, astronautas y misiones espaciales.',
    intro:
      'Preguntas sobre el espacio con respuestas: los planetas del sistema solar, el Sol y la Luna, estrellas y galaxias, eclipses, astronautas y las misiones espaciales más famosas. Toca «Ver respuesta» para comprobar si has acertado.',
    filter: (q, cat) => ['ciencia', 'historia'].includes(cat) && words(['planeta', 'luna\\b', 'sol\\b', 'estrella', 'galaxia', 'via lactea', 'astronauta', 'cosmonauta', 'espacio', 'espacial', 'nasa', 'apolo', 'sputnik', 'eclipse', 'anillos', 'marte', 'jupiter', 'saturno', 'venus', 'neptuno', 'pluton', 'telescopio', 'james webb', 'perseverance', 'laika', 'ganimedes', 'satelite', 'gagarin', 'armstrong', 'tereshkova', 'transbordador'], ['rey', 'vitamina', 'placas', 'gotas de lluvia', 'dios principal'])(q),
  },
  'preguntas-trampa': {
    name: 'Preguntas trampa',
    title: 'Preguntas trampa con respuestas',
    desc: 'Preguntas trampa con respuestas para pillar a tus amigos: acertijos rápidos que casi todo el mundo falla. ¿Cuántas aciertas?',
    intro:
      'Preguntas trampa con respuestas: acertijos cortos que parecen fáciles pero esconden un truco. Son perfectas para una cena, un viaje en coche o para pillar a tus amigos. Léelas en voz alta, deja que contesten rápido… y luego toca «Ver respuesta».',
    filter: (q) => q.tag === 'trampa',
  },
  halloween: {
    name: 'Halloween',
    title: 'Preguntas de Halloween con respuestas',
    desc: 'Preguntas de Halloween con respuestas: origen de la fiesta, Todos los Santos, Día de Muertos, monstruos, brujas y películas de miedo.',
    intro:
      'Preguntas de Halloween con respuestas: de dónde viene la fiesta, cómo se celebra Todos los Santos en España, el Día de Muertos de México, vampiros, brujas, hombres lobo y películas de miedo. Ideales para una fiesta de disfraces o para clase. Toca «Ver respuesta» para comprobar si has acertado.',
    filter: (q) => q.tag === 'halloween' || /halloween|dracula|frankenstein|todos los santos/.test(norm(`${q.text} ${q.correct}`)),
  },
  navidad: {
    name: 'Navidad',
    title: 'Preguntas de Navidad con respuestas',
    desc: 'Preguntas de Navidad con respuestas: Reyes Magos, uvas de Nochevieja, Lotería, villancicos, turrón y tradiciones de España y del mundo.',
    intro:
      'Preguntas de Navidad con respuestas: los Reyes Magos, las uvas y las campanadas, la Lotería de Navidad, los villancicos, el turrón, el belén y las tradiciones de cada rincón de España y del mundo. Perfectas para la cena de Nochebuena o para jugar en familia. Toca «Ver respuesta» para comprobar si has acertado.',
    filter: (q) => q.tag === 'navidad' || /navidad|nochebuena|nochevieja|reyes magos|papa noel|villancico|turron/.test(norm(`${q.text} ${q.correct}`)),
  },
  mitologia: {
    name: 'Mitología',
    title: 'Preguntas de mitología con respuestas',
    desc: 'Preguntas de mitología griega, romana, nórdica y egipcia con respuestas: dioses, héroes, monstruos y leyendas.',
    intro:
      'Preguntas de mitología con respuestas: los dioses del Olimpo y sus nombres romanos, héroes como Aquiles, Hércules o Ulises, monstruos como Medusa o el Minotauro, y los dioses nórdicos y egipcios. Toca «Ver respuesta» para comprobar si has acertado.',
    filter: (q) => q.tag === 'mitologia' || words(['mitolog', 'zeus', 'poseidon', 'atenea', 'afrodita', 'hades', 'aquiles', 'hercules', 'heracles', 'ulises', 'odisea', 'iliada', 'minotauro', 'medusa', 'pegaso', 'olimpo', 'odin', 'loki', 'valhalla', 'anubis', 'osiris', 'romulo'])(q),
  },
  inventos: {
    name: 'Inventos',
    title: 'Preguntas de inventos e inventores con respuestas',
    desc: 'Preguntas sobre inventos e inventores con respuestas: la imprenta, el teléfono, la bombilla, el avión, internet e inventos españoles.',
    intro:
      'Preguntas sobre inventos e inventores con respuestas: quién inventó la imprenta, el teléfono, la bombilla, el avión o internet, y los grandes inventos españoles como la fregona, el submarino o el autogiro. Toca «Ver respuesta» para comprobar si has acertado.',
    filter: (q) => q.tag === 'inventos' || words(['invent', 'patent', 'descubri'], ['asesino', 'oceano'])(q),
  },
  'geografia-de-espana': {
    name: 'Geografía de España',
    title: 'Preguntas de geografía de España con respuestas',
    desc: 'Preguntas de geografía de España con respuestas: comunidades autónomas, provincias, capitales, ríos, montañas e islas.',
    intro:
      'Preguntas de geografía de España con respuestas: comunidades autónomas y sus capitales, provincias, ríos como el Ebro o el Tajo, montañas, islas y ciudades. Muy útiles para repasar para el colegio o las oposiciones. Toca «Ver respuesta» para comprobar si has acertado.',
    filter: inCats(['geografia'], (q) => /espan|madrid|comunidad|provincia|canarias|baleares|andaluc|castilla|cataluna|galicia|asturias|ebro|tajo|duero|guadalquivir|teide|pirineos|cantabr|navarra|aragon|extremadura|murcia|valencia|rioja|vasco|bilbao|sevilla|toledo|granada/.test(norm(`${q.text} ${q.correct}`))),
  },
  'historia-antigua': {
    name: 'Historia antigua',
    title: 'Preguntas de historia antigua con respuestas',
    desc: 'Preguntas de historia antigua con respuestas: Egipto, Grecia, Roma, faraones, emperadores, pirámides y grandes batallas.',
    intro:
      'Preguntas de historia antigua con respuestas: el Egipto de los faraones y las pirámides, la Grecia de Atenas y Esparta, y Roma desde su fundación hasta el Imperio. Toca «Ver respuesta» para comprobar si has acertado.',
    filter: inCats(['historia', 'arte', 'general', 'geografia'], words(['romano', 'romana', 'roma\\b', 'grecia', 'griego', 'griega', 'cesar', 'augusto', 'atenas', 'esparta', 'egipt', 'faraon', 'piramide', 'cleopatra', 'alejandro magno', 'tutankamon', 'coliseo', 'pompeya', 'hispania', 'cartago', 'anibal'], ['papa', 'iglesia', 'capital', 'equipo', 'numero', 'tratado', 'continente', 'pintor', 'pinto', 'arquitecto'])),
  },
  pintura: {
    name: 'Pintura y museos',
    title: 'Preguntas de pintura y arte con respuestas',
    desc: 'Preguntas de pintura con respuestas: Velázquez, Goya, Picasso, Dalí, Da Vinci, Van Gogh, cuadros famosos y museos.',
    intro:
      'Preguntas de pintura con respuestas: quién pintó los cuadros más famosos, en qué museo están y los grandes pintores españoles y del mundo, de Velázquez y Goya a Picasso, Dalí, Da Vinci o Van Gogh. Toca «Ver respuesta» para comprobar si has acertado.',
    filter: inCats(['arte', 'general', 'historia'], words(['pinto', 'pintor', 'pintora', 'pintura', 'cuadro', 'museo', 'lienzo', 'escultur', 'velazquez', 'goya', 'picasso', 'dali\\b', 'miro\\b', 'van gogh', 'da vinci', 'gioconda', 'mona lisa', 'meninas', 'guernica', 'prado', 'louvre'], ['premios'])),
  },
  tecnologia: {
    name: 'Tecnología',
    title: 'Preguntas de tecnología e internet con respuestas',
    desc: 'Preguntas de tecnología con respuestas: internet, ordenadores, móviles, videojuegos, redes sociales y grandes empresas tecnológicas.',
    intro:
      'Preguntas de tecnología con respuestas: internet y las redes sociales, ordenadores y móviles, videojuegos y consolas, y las empresas que lo cambiaron todo. Toca «Ver respuesta» para comprobar si has acertado.',
    filter: words(['internet', 'ordenador', 'movil', 'smartphone', 'app\\b', 'aplicacion', 'google', 'apple', 'microsoft', 'facebook', 'amazon', 'videojuego', 'consola', 'nintendo', 'playstation', 'software', 'wifi', 'correo electronico', 'robot', 'inteligencia artificial', 'www', 'tecnolog', 'byte', 'bits?\\b', 'informatic', 'red social', 'redes sociales', 'tiktok', 'instagram', 'youtube', 'whatsapp', 'minecraft', 'tetris', 'mario\\b'], ['tipos moviles', 'amazonas', 'rio\\b', 'vargas llosa', 'orellana']),
  },
  matematicas: {
    name: 'Matemáticas',
    title: 'Preguntas de matemáticas y lógica con respuestas',
    desc: 'Preguntas de matemáticas y lógica con respuestas: cálculo mental, números romanos, geometría y problemas rápidos.',
    intro:
      'Preguntas de matemáticas y lógica con respuestas: cálculo mental, fracciones y porcentajes, números romanos, geometría y pequeños problemas para pensar rápido. Toca «Ver respuesta» para comprobar si has acertado.',
    filter: inCats(['general', 'ciencia'], (q) => /(\bcuanto es\b|\bnumeros?\b|\bsuma\b|\braiz\b|\bimpar\b|\bprimo\b|\bmultiplic|\bdivid|\bporcentaje|\bgeometr|\btriangulo|\bcirculo|\bangulo|\bpi\b|\becuacion|\bfraccion|\bromano|\blados\b|\bhexagono|\boctogono|\bpentagono|\bdocena|\bcentena|\bmillon)/.test(norm(`${q.text} ${q.correct}`)) && !/emergencia|mala suerte|personas|supercontinente|planta/.test(norm(q.text))),
  },
};
const MIN_THEME = 20;

const LEVELS = { 1: 'Preguntas fáciles', 2: 'Preguntas de dificultad media', 3: 'Preguntas difíciles' };

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Orden fijo de las opciones (para que la correcta no sea siempre la primera y la página no cambie).
function shuffledOptions(q) {
  const opts = [q.correct, ...q.wrong];
  const seed = crypto.createHash('md5').update(q.text).digest();
  for (let i = opts.length - 1; i > 0; i--) {
    const j = seed[i] % (i + 1);
    [opts[i], opts[j]] = [opts[j], opts[i]];
  }
  return opts;
}

let cache = null;
function load() {
  if (cache) return cache;
  cache = {};
  for (const cat of ORDER) {
    const list = JSON.parse(fs.readFileSync(path.join(DIR, `${cat}.json`), 'utf8'));
    cache[cat] = list.map(([text, correct, wrong, difficulty, explanation, tag]) => ({ text, correct, wrong, difficulty: difficulty || 2, explanation, tag: tag || null }));
  }
  return cache;
}

function layout({ title, description, canonical, body }) {
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#1b1035">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <link rel="canonical" href="${esc(canonical)}">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:url" content="${esc(canonical)}">
  <meta property="og:image" content="/img/og-image.jpg">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="icon" href="/img/favicon-48.png" type="image/png" sizes="48x48">
  <link rel="icon" href="/icon.svg" type="image/svg+xml">
  <link rel="apple-touch-icon" href="/img/apple-touch-icon.png">
  <link rel="manifest" href="/manifest.webmanifest">
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <div class="container">
    <header class="site-header">
      <a class="logo" href="/" aria-label="Yo Soy Listo · Inicio"><img src="/img/logo.webp" alt="Yo Soy Listo" width="900" height="580"></a>
      <a class="me-chip" href="/">🎮 Jugar</a>
    </header>
${body}
    <footer class="site-footer">© Yo Soy Listo · <a href="/preguntas">Preguntas con respuestas</a> · <a href="/privacidad">Privacidad</a></footer>
  </div>
</body>
</html>`;
}

function catLinks(current) {
  return `<nav class="qa-cats" aria-label="Categorías">${ORDER.map(
    (c) => `<a href="/preguntas/${c}"${c === current ? ' aria-current="page"' : ''}>${esc(CATS[c].name)}</a>`
  ).join('')}</nav>`;
}

function cta(cat) {
  return `<section class="card qa-cta">
      <h2>¿Te atreves a jugar de verdad?</h2>
      <p>En Yo Soy Listo respondes contra el reloj y contra otros jugadores: conquista el mapa de España, reta a un amigo a un duelo o haz el reto diario. Gratis y desde el móvil.</p>
      <a class="btn" href="/blitz${cat ? `?cat=${cat}` : ''}">⚡ Jugar${cat ? ` a ${esc(CATS[cat].name.toLowerCase())}` : ''} (60 segundos)</a>
      <a class="btn btn-secondary" href="/conquista">🏰 Conquistar España</a>
    </section>`;
}

function indexPage(base) {
  const qs = load();
  const total = ORDER.reduce((s, c) => s + qs[c].length, 0);
  const cards = ORDER.map((c) => {
    const sample = qs[c].find((q) => q.difficulty === 1) || qs[c][0];
    return `<a class="card qa-cat-card" href="/preguntas/${c}">
        <strong>${esc(CATS[c].title)}</strong>
        <span>${qs[c].length} preguntas · Ej.: «${esc(sample.text)}»</span>
      </a>`;
  }).join('\n      ');
  const body = `    <main>
      <section class="card prose qa-head">
        <h1>Preguntas de trivial con respuestas</h1>
        <p>Más de ${(Math.floor(total / 100) * 100).toLocaleString('es-ES')} preguntas de cultura general con sus respuestas, divididas por categorías y por dificultad. Úsalas para un trivial con amigos, para clase o para repasar… y cuando estés listo, demuestra lo que sabes jugando online.</p>
      </section>
      ${cards}
      <section class="card qa-head"><h2>Por temas</h2>${themeLinks(null)}</section>
      ${cta(null)}
    </main>`;
  return layout({
    title: 'Preguntas de trivial con respuestas por categorías · Yo Soy Listo',
    description: `Más de ${(Math.floor(total / 100) * 100).toLocaleString('es-ES')} preguntas de trivial con respuestas: cultura general, historia, geografía, ciencia, arte y deportes. Gratis.`,
    canonical: `${base}/preguntas`,
    body,
  });
}

function themeQuestions(slug) {
  const t = THEMES[slug];
  const all = load();
  const seen = new Set();
  const out = [];
  for (const cat of ORDER) {
    for (const q of all[cat]) {
      if (!seen.has(q.text) && t.filter(q, cat)) {
        seen.add(q.text);
        out.push(q);
      }
    }
  }
  return out;
}

const activeThemes = () => Object.keys(THEMES).filter((slug) => themeQuestions(slug).length >= MIN_THEME);

function themeLinks(current) {
  return `<nav class="qa-cats" aria-label="Temas">${activeThemes()
    .map((t) => `<a href="/preguntas/${t}"${t === current ? ' aria-current="page"' : ''}>${esc(THEMES[t].name)}</a>`)
    .join('')}</nav>`;
}

function categoryPage(base, cat) {
  const isTheme = !CATS[cat];
  const info = isTheme ? THEMES[cat] : CATS[cat];
  const list = isTheme ? themeQuestions(cat) : load()[cat];
  let n = 0;
  const sections = [1, 2, 3]
    .map((level) => {
      const qs = list.filter((q) => q.difficulty === level);
      if (!qs.length) return '';
      const items = qs
        .map((q) => {
          n += 1;
          const opts = shuffledOptions(q)
            .map((o) => `<li>${esc(o)}</li>`)
            .join('');
          const expl = q.explanation ? ` <span class="qa-expl">${esc(q.explanation)}</span>` : '';
          return `<li class="qa-item"><p class="qa-q"><span class="qa-n">${n}.</span> ${esc(q.text)}</p><ol class="qa-opts" type="a">${opts}</ol><details><summary>Ver respuesta</summary><p class="qa-a">✅ <strong>${esc(q.correct)}</strong>.${expl}</p></details></li>`;
        })
        .join('\n');
      return `<section class="card qa-level"><h2>${LEVELS[level]} (${qs.length})</h2><ol class="qa-list">\n${items}\n</ol></section>`;
    })
    .join('\n');
  const body = `    <main>
      <section class="card prose qa-head">
        <p class="qa-crumbs"><a href="/preguntas">Preguntas con respuestas</a> › ${esc(info.name)}</p>
        <h1>${esc(info.title)} (${list.length})</h1>
        <p>${esc(info.intro)}</p>
        ${catLinks(isTheme ? null : cat)}
        ${themeLinks(isTheme ? cat : null)}
      </section>
      ${sections}
      ${cta(isTheme ? null : cat)}
    </main>`;
  // Título pensado para el clic: «125 preguntas de arte con respuestas (fáciles y difíciles)».
  const count = list.length >= 100 ? Math.floor(list.length / 10) * 10 : list.length;
  const levels = new Set(list.map((q) => q.difficulty));
  const tail = levels.has(1) && levels.has(3) ? ' (fáciles y difíciles)' : '';
  const lead = `${count}${list.length > count ? '+' : ''} ${info.title.charAt(0).toLowerCase()}${info.title.slice(1)}`;
  return layout({
    title: `${lead}${tail}`,
    description: `${info.desc} ${count} preguntas con soluciones, gratis.`,
    canonical: `${base}/preguntas/${cat}`,
    body,
  });
}

const exists = (slug) => !!CATS[slug] || activeThemes().includes(slug);
const SEO_PATHS = ['/preguntas', ...ORDER.map((c) => `/preguntas/${c}`), ...activeThemes().map((t) => `/preguntas/${t}`)];

module.exports = { indexPage, categoryPage, exists, themeQuestions, CATS, THEMES, ORDER, SEO_PATHS };
