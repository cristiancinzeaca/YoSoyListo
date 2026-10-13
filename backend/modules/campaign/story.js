// La campaña «Las Crónicas de Sapiencia»: historia, combates y jefes.
// {nombre} se cambia por el nombre del jugador. Cada capítulo: escenas (story), combates (battle) y jefe (boss).
//
// Hablantes: 'ulula' (el búho guía), 'heroe' (tu héroe), 'jefe' (el jefe del capítulo),
// 'narrador' y personajes secundarios definidos en SPEAKERS.

const SPEAKERS = {
  ulula: { name: 'Maestro Ulula', img: '/img/avatar-buho.webp' },
  narrador: { name: '', img: null },
  alcaldesa: { name: 'Alcaldesa Remedios', img: null, icon: '👵' },
  anciana: { name: 'Abuela Hojarasca', img: null, icon: '🌳' },
  herrero: { name: 'Maese Yunque', img: null, icon: '⚒️' },
  jefa: { name: 'Gran Jefa Truena', img: null, icon: '🥁' },
  bibliotecaria: { name: 'Sor Signatura', img: null, icon: '📚' },
  grumete: { name: 'Grumete Pipo', img: null, icon: '🦜' },
  arqueologa: { name: 'Doctora Estrato', img: null, icon: '🏺' },
  aprendiz: { name: 'Chispa, la aprendiz', img: null, icon: '🔧' },
};

const BOSSES = {
  pregonero: { name: 'El Pregonero Mudo', img: '/img/lore/jefe-pregonero.webp' },
  driade: { name: 'La Dríade Desmemoriada', img: '/img/lore/jefe-driade.webp' },
  golem: { name: 'El Gólem Oxidado', img: '/img/lore/jefe-golem.webp' },
  chaman: { name: 'El Chamán del Bostezo', img: '/img/lore/jefe-chaman.webp' },
  bibliofago: { name: 'El Bibliófago', img: '/img/lore/jefe-bibliofago.webp' },
  quizas: { name: 'Capitán Quizás', img: '/img/lore/jefe-quizas.webp' },
  cronofaga: { name: 'La Cronófaga', img: '/img/lore/jefe-cronofaga.webp' },
  chapuza: { name: 'Doctor Chapuza', img: '/img/lore/jefe-chapuza.webp' },
  olvido: { name: 'El Olvido', img: '/img/lore/jefe-olvido.webp' },
};

const MINION = { name: 'Desmemoriados', img: '/img/lore/desmemoriado.webp' };

const s = (id, title, lines) => ({ id, type: 'story', title, lines });
const b = (id, title, hp, enemy = MINION) => ({ id, type: 'battle', title, hp, enemy });
const boss = (id, key, hp) => ({ id, type: 'boss', title: BOSSES[key].name, hp, enemy: BOSSES[key], bossKey: key });

const CHAPTERS = [
  // ---------------------------------------------------------------- prólogos
  {
    id: 'pro-humano',
    race: 'humano',
    title: 'Prólogo: Alejandría Nueva',
    place: 'La ciudad de las mil plazas',
    category: 'general',
    img: '/img/lore/cap-humano.webp',
    reward: { item: 'heroe_alejandria' },
    nodes: [
      s('h1', 'Una mañana muy rara', [
        ['narrador', 'Alejandría Nueva amanece como siempre: churros, campanas y gente discutiendo de fútbol en la plaza.'],
        ['narrador', 'Pero hoy nadie recuerda el resultado del partido de ayer. Ni el de anteayer. Ni cómo se llama el alcalde.'],
        ['alcaldesa', '¡Que soy la alcaldesa! ¡Llevo cuarenta años siéndolo! ...Creo.'],
        ['ulula', 'Uh-uh. Una niebla gris ha entrado por la Puerta Norte. Donde toca, la gente olvida. Lo llaman el Olvido.'],
        ['ulula', 'Tú, {nombre}, todavía recuerdas cosas. Eso te convierte, oficialmente, en nuestra mejor opción. Y en la única.'],
        ['heroe', '¿Y qué hago? ¿Le pego a la niebla?'],
        ['ulula', 'Casi. Contra el Olvido solo sirve una cosa: saber las respuestas. Cada verdad que dices en voz alta la hace retroceder.'],
      ]),
      b('h2', 'Desmemoriados en la plaza', 3),
      s('h3', 'El mercado en silencio', [
        ['narrador', 'Los vecinos despiertan, parpadean y se miran avergonzados. Uno lleva un churro en cada oreja.'],
        ['ulula', 'Bien hecho. Pero la niebla sale del Ayuntamiento. Alguien la está repartiendo… con megáfono.'],
      ]),
      b('h4', 'Las calles de la niebla', 4),
      s('h5', 'El pregón que nadie entiende', [
        ['narrador', 'En el balcón del Ayuntamiento, un pregonero agita su campana. De su boca no salen palabras: sale niebla.'],
        ['jefe', '…'],
        ['ulula', 'Es Bartolo, el pregonero. El Olvido le ha robado todas las palabras. Devuélveselas con respuestas, {nombre}.'],
      ]),
      boss('h6', 'pregonero', 5),
      s('h7', 'La primera pista', [
        ['jefe', '¡¡¡PUEDO HABLAR!!! ¡Oídos de Alejandría, os anuncio que… que… ¡que gracias!'],
        ['ulula', 'La niebla vino del norte, de la Gran Biblioteca de Sapiencia. Si cae la Biblioteca, caerá todo lo que sabemos.'],
        ['ulula', 'Haz la maleta, {nombre}. Y no te olvides el cepillo de dientes. Literalmente: no te lo olvides.'],
      ]),
    ],
  },
  {
    id: 'pro-elfo',
    race: 'elfo',
    title: 'Prólogo: El Bosque de las Mil Páginas',
    place: 'Donde los árboles tienen hojas… de libro',
    category: 'arte',
    img: '/img/lore/cap-elfo.webp',
    reward: { item: 'heroe_bosque' },
    nodes: [
      s('e1', 'Hojas en blanco', [
        ['narrador', 'En el Bosque de las Mil Páginas, cada hoja de cada árbol guarda un poema, un cuadro o una canción.'],
        ['narrador', 'Esta mañana, las hojas han caído… en blanco.'],
        ['anciana', 'Mil años contando historias, y hoy no recuerdo ni cómo empieza «Érase una vez».'],
        ['ulula', 'Uh-uh. Es el Olvido, una niebla que se come la memoria. Tú, {nombre}, aún recuerdas el arte del bosque.'],
        ['heroe', 'Entonces habrá que recordar por todos.'],
        ['ulula', 'Exacto. Cada respuesta correcta devuelve la tinta a una hoja. Empecemos por esos elfos que están abrazando piedras.'],
      ]),
      b('e2', 'Los elfos que olvidaron cantar', 3),
      s('e3', 'El claro de los pintores', [
        ['narrador', 'Los pinceles flotan solos sin saber qué pintar. Uno intenta un autorretrato… de una patata.'],
        ['ulula', 'La niebla sale del Árbol Madre. Y algo, o alguien, la está regando.'],
      ]),
      b('e4', 'El sendero de los lienzos vacíos', 4),
      s('e5', 'El Árbol Madre', [
        ['narrador', 'Junto al Árbol Madre espera una dríade de corteza gris. Sus ojos brillan como dos páginas sin escribir.'],
        ['jefe', '¿Quién eres? ¿Quién soy? ¿Por qué tengo ramas? Da igual… ¡olvídalo todo conmigo!'],
      ]),
      boss('e6', 'driade', 5),
      s('e7', 'Las hojas recuerdan', [
        ['jefe', 'Ah… ahora recuerdo. Yo era la guardiana de los poemas. Gracias, pequeño artista.'],
        ['ulula', 'La niebla llegó desde la Gran Biblioteca de Sapiencia. Allí empieza el verdadero viaje, {nombre}.'],
      ]),
    ],
  },
  {
    id: 'pro-enano',
    race: 'enano',
    title: 'Prólogo: La Forja de la Memoria',
    place: 'Bajo las Montañas de Hierro',
    category: 'ciencia',
    img: '/img/lore/cap-enano.webp',
    reward: { item: 'heroe_forja' },
    nodes: [
      s('d1', 'Fórmulas olvidadas', [
        ['narrador', 'En la Forja de la Memoria, los enanos graban en piedra todo lo que saben. Llevan haciéndolo diez mil años.'],
        ['herrero', '¡Por mis barbas! ¿Cuántos grados hacen falta para fundir el hierro? ¡Lo sabía! ¡Lo tenía en la punta de la barba!'],
        ['ulula', 'Uh-uh. Una niebla gris ha bajado por los túneles. Se llama el Olvido y borra hasta las runas.'],
        ['heroe', 'Las runas son piedra. ¿Cómo va a borrar la piedra?'],
        ['ulula', 'Con mucha paciencia y muy mala leche. Pero tú aún recuerdas la ciencia, {nombre}. Úsala.'],
      ]),
      b('d2', 'Mineros desmemoriados', 3),
      s('d3', 'Los hornos apagados', [
        ['narrador', 'Los hornos se han apagado porque nadie recuerda cómo se encienden. Un enano intenta prenderlos soplando.'],
        ['ulula', 'La niebla sale de la Cámara del Gólem. Y el gólem lleva siglos dormido… o eso creíamos.'],
      ]),
      b('d4', 'Los túneles de la niebla', 4),
      s('d5', 'La Cámara del Gólem', [
        ['narrador', 'Un gigante de piedra y hierro se levanta entre crujidos. Está tan oxidado que rechina al pensar.'],
        ['jefe', 'CRRRK. PROTOCOLO… OLVIDADO. NUEVO PROTOCOLO: QUE NADIE RECUERDE NADA. CRRRK.'],
      ]),
      boss('d6', 'golem', 5),
      s('d7', 'La runa encendida', [
        ['jefe', 'CRRRK… MEMORIA RESTAURADA. GRACIAS, PEQUEÑO GENIO. ME VENDRÍA BIEN UN POCO DE ACEITE.'],
        ['ulula', 'El Olvido viene de la Gran Biblioteca de Sapiencia. Allí nos espera algo peor que el óxido, {nombre}.'],
      ]),
    ],
  },
  {
    id: 'pro-orco',
    race: 'orco',
    title: 'Prólogo: Las Estepas del Tambor',
    place: 'Donde los clanes compiten por todo',
    category: 'deportes',
    img: '/img/lore/cap-orco.webp',
    reward: { item: 'heroe_tambor' },
    nodes: [
      s('o1', 'El gran torneo… olvidado', [
        ['narrador', 'En las Estepas del Tambor, los clanes orcos resuelven todo con competiciones: carreras, lanzamientos y, sobre todo, apuestas.'],
        ['jefa', '¡Hoy es el Gran Torneo! ¿O era ayer? ¿Y quién ganó el año pasado? ¡¿Quién tiene la copa?!'],
        ['ulula', 'Uh-uh. El Olvido ha llegado a las estepas. Una niebla que borra récords, reglas y resultados.'],
        ['heroe', '¿Sin récords? Eso es peor que una guerra.'],
        ['ulula', 'Me alegra que lo entiendas, {nombre}. Tú aún recuerdas los deportes del mundo. Demuéstralo.'],
      ]),
      b('o2', 'Atletas sin rumbo', 3),
      s('o3', 'La pista vacía', [
        ['narrador', 'Dos orcos corren en direcciones opuestas porque ninguno recuerda dónde está la meta. Ambos dicen que han ganado.'],
        ['ulula', 'Escucha… ese tambor. Cada golpe esparce más niebla. Y bostezos. Muchos bostezos.'],
      ]),
      b('o4', 'El campamento dormido', 4),
      s('o5', 'El tambor del sueño', [
        ['narrador', 'Sobre una roca, un viejo chamán golpea un tambor enorme. Cada golpe, un bostezo; cada bostezo, un recuerdo menos.'],
        ['jefe', 'Uaaaah… ¿para qué recordar, si se puede dormir? Túmbate, joven. Olvida…'],
      ]),
      boss('o6', 'chaman', 5),
      s('o7', '¡Despierta, estepa!', [
        ['jefe', '¡Por los ancestros! ¡Estoy despierto! ¡Y recuerdo que yo gané el torneo de 1987!'],
        ['ulula', 'El tambor le llegó desde el norte, desde la Gran Biblioteca de Sapiencia. Prepárate, {nombre}.'],
      ]),
    ],
  },
  // ---------------------------------------------------------------- campaña común
  {
    id: 'c1',
    title: 'Capítulo 1: La Gran Biblioteca',
    place: 'El corazón del saber de Sapiencia',
    category: 'arte',
    img: '/img/lore/cap-biblioteca.webp',
    reward: { item: 'biblioteca' },
    nodes: [
      s('c1a', 'Un millón de libros en blanco', [
        ['narrador', 'La Gran Biblioteca tiene un millón de libros. Hoy, la mitad están en blanco y la otra mitad, mordidos.'],
        ['bibliotecaria', '¡Silencio! …Perdón, la costumbre. ¡Socorro! ¡Algo se está comiendo la sección de poesía!'],
        ['ulula', 'Uh-uh. Aquí empezó todo, {nombre}. El Olvido nació en el sótano, donde se guardan los libros que nadie lee.'],
        ['heroe', '¿Y qué se come los libros?'],
        ['bibliotecaria', 'No lo sabemos. Lleva gafas. Y deja migas de índice por todas partes.'],
      ]),
      b('c1b', 'Lectores desmemoriados', 4),
      s('c1c', 'La sección prohibida', [
        ['narrador', 'Un rastro de páginas masticadas baja hacia el sótano. Huele a papel viejo y a hambre.'],
        ['ulula', 'Si se come la sección de arte y literatura, nadie recordará quién pintó qué ni quién escribió qué. Rápido.'],
      ]),
      b('c1d', 'Guardianes de tinta', 5),
      s('c1e', 'El Bibliófago', [
        ['narrador', 'En el sótano, un gusano gigantesco con gafas redondas mastica una enciclopedia entera.'],
        ['jefe', '¡Mmm, el Quijote! Un poco seco, pero con mucha fibra. ¿Quieres que te cuente cómo acaba? Ah, no, que ya lo he olvidado. ¡JA!'],
      ]),
      boss('c1f', 'bibliofago', 7),
      s('c1g', 'Un mapa en el estómago', [
        ['jefe', 'Uf… creo que me sentó mal el diccionario. Toma, se me había atragantado esto.'],
        ['narrador', 'El Bibliófago escupe un mapa empapado. Una ruta marcada cruza el Mar de la Duda.'],
        ['ulula', 'El Olvido no es solo una niebla, {nombre}. Tiene un dueño. Y su rastro va hacia el mar.'],
      ]),
    ],
  },
  {
    id: 'c2',
    title: 'Capítulo 2: El Mar de la Duda',
    place: 'Donde ninguna brújula sabe dónde está el norte',
    category: 'geografia',
    img: '/img/lore/cap-mar.webp',
    reward: { item: 'marea' },
    nodes: [
      s('c2a', 'Brújulas mareadas', [
        ['narrador', 'En el Mar de la Duda, las brújulas giran como peonzas y los mapas cambian de opinión cada cinco minutos.'],
        ['grumete', '¡A estribor! ¡No, a babor! ¿Cuál era la izquierda? ¡Cuac!'],
        ['ulula', 'Necesitamos a alguien que sepa dónde está cada cosa del mundo. Ríos, capitales, montañas…'],
        ['heroe', 'Vale. Pero que conste que me mareo en barco.'],
      ]),
      b('c2b', 'Marineros sin rumbo', 4),
      s('c2c', 'La isla que no estaba', [
        ['narrador', 'Una isla aparece y desaparece en el horizonte. Cada vez que alguien duda, la isla se mueve.'],
        ['grumete', '¡Es el barco del Capitán Quizás! Nunca responde nada. ¡Ni la hora!'],
      ]),
      b('c2d', 'Piratas de la niebla', 5),
      s('c2e', 'Capitán Quizás', [
        ['narrador', 'Un pirata salta a cubierta. En lugar de garfio lleva un enorme signo de interrogación.'],
        ['jefe', '¿Que si he robado el mapa del mundo? Quizás. ¿Que si sé dónde está el Olvido? Puede ser. ¿Que si te voy a hundir? ¡Eso, a lo mejor!'],
      ]),
      boss('c2f', 'quizas', 7),
      s('c2g', 'Un rumbo seguro', [
        ['jefe', 'Vale, vale, me rindo. Sí. Seguro. Definitivamente. ¡Uf, qué raro se me hace decir eso!'],
        ['jefe', 'El Olvido se esconde más allá de las Ruinas del Tiempo. Lo sé… quizá. ¡Es broma! Lo sé seguro.'],
        ['ulula', 'Las Ruinas guardan la historia del mundo, {nombre}. Si el Olvido llega allí, será como si nada hubiera pasado nunca.'],
      ]),
    ],
  },
  {
    id: 'c3',
    title: 'Capítulo 3: Las Ruinas del Tiempo',
    place: 'Donde cada piedra recuerda un siglo',
    category: 'historia',
    img: '/img/lore/cap-ruinas.webp',
    reward: { item: 'reloj' },
    nodes: [
      s('c3a', 'Relojes de arena vacíos', [
        ['narrador', 'Las Ruinas del Tiempo están llenas de estatuas de reyes, batallas y descubrimientos. Hoy, todas tienen la cara borrada.'],
        ['arqueologa', '¡Un desastre! Esta estatua era de un emperador romano y ahora parece un señor esperando el autobús.'],
        ['ulula', 'Uh-uh. Si el mundo olvida su historia, repetirá todos sus errores. Y algunos fueron muy feos.'],
      ]),
      b('c3b', 'Estatuas sin rostro', 4),
      s('c3c', 'El reloj que come horas', [
        ['narrador', 'En el centro de las ruinas, el gran reloj de sol ya no da sombra. Alguien se ha comido el mediodía.'],
        ['arqueologa', 'Cuentan que una dama de engranajes devora el tiempo. Primero las horas, luego los siglos…'],
      ]),
      b('c3d', 'Soldados de otro siglo', 5),
      s('c3e', 'La Cronófaga', [
        ['narrador', 'Una dama elegante, con la falda hecha de engranajes, enrolla una aguja de reloj como si fuera espagueti.'],
        ['jefe', 'Mmm, el siglo XV… sabe a pólvora y a descubrimientos. ¿Te apetece un bocado de Edad Media?'],
      ]),
      boss('c3f', 'cronofaga', 8),
      s('c3g', 'La hora exacta', [
        ['jefe', 'Qué indigestión de fechas… Está bien, devuelvo los siglos. Pero el Olvido me prometió el futuro entero.'],
        ['ulula', '¿El futuro? Entonces va a por los inventos. A la Torre de los Mil Inventos, {nombre}. ¡Rápido!'],
      ]),
    ],
  },
  {
    id: 'c4',
    title: 'Capítulo 4: La Torre de los Mil Inventos',
    place: 'Cada piso, un descubrimiento',
    category: 'ciencia',
    img: '/img/lore/cap-torre.webp',
    reward: { item: 'mecanica' },
    nodes: [
      s('c4a', 'Inventos que no funcionan', [
        ['narrador', 'La Torre de los Mil Inventos tiene mil pisos y un ascensor que nadie recuerda cómo funciona. Hay que subir andando.'],
        ['aprendiz', '¡Hola! Soy Chispa. Mi maestro se ha vuelto loco: dice que la ciencia es aburrida y que es mejor inventar sin saber.'],
        ['ulula', 'Inventar sin saber… Eso no es ciencia, es una explosión esperando a ocurrir.'],
      ]),
      b('c4b', 'Robots confundidos', 4),
      s('c4c', 'El piso 999', [
        ['narrador', 'Humo, chispas y un olor a pelo quemado. En el último piso algo hace «¡PUM!» cada pocos segundos.'],
        ['aprendiz', 'Ese es el laboratorio de mi maestro. Cuidado: lleva tres días sin acertar una fórmula.'],
      ]),
      b('c4d', 'Experimentos fallidos', 5),
      s('c4e', 'Doctor Chapuza', [
        ['narrador', 'Un inventor con las gafas humeantes sostiene un aparato que vibra peligrosamente.'],
        ['jefe', '¡Contempla mi obra maestra: la Máquina de Olvidar! Funciona al 100 %… o al 3 %. ¡No recuerdo las matemáticas!'],
      ]),
      boss('c4f', 'chapuza', 8),
      s('c4g', 'Eureka', [
        ['jefe', 'Ay, mi cabeza… ¡Recuerdo! La gravedad, la electricidad, el método científico… Qué vergüenza.'],
        ['jefe', 'El Olvido me prometió que inventaría sin estudiar. Vive en el Corazón del Olvido, al final de todos los mapas.'],
        ['ulula', 'Ha llegado la hora, {nombre}. Todo lo que has aprendido te ha traído hasta aquí.'],
      ]),
    ],
  },
  {
    id: 'c5',
    title: 'Capítulo 5: El Corazón del Olvido',
    place: 'El lugar donde van las cosas olvidadas',
    category: null,
    img: '/img/lore/cap-corazon.webp',
    reward: { item: 'niebla', item2: 'vencedor' },
    nodes: [
      s('c5a', 'Todo lo olvidado', [
        ['narrador', 'El Corazón del Olvido es un desierto de cosas perdidas: llaves, paraguas, cumpleaños, contraseñas y calcetines desparejados.'],
        ['ulula', 'Aquí acaba todo lo que el mundo olvida. Si fallamos, Sapiencia entera acabará aquí.'],
        ['heroe', 'Pues entonces no vamos a fallar.'],
        ['ulula', 'Uh-uh. Eso me gusta. Lo apunto, por si se me olvida.'],
      ]),
      b('c5b', 'El ejército de la niebla', 5),
      s('c5c', 'Ecos del camino', [
        ['narrador', 'De la niebla salen ecos conocidos: el pregonero, la dríade, el gólem, el chamán… todos te animan desde lejos.'],
        ['ulula', 'Tu viaje ha dejado huella, {nombre}. Ellos recuerdan gracias a ti.'],
      ]),
      b('c5d', 'Las sombras de los jefes', 6),
      s('c5e', 'El Olvido', [
        ['narrador', 'Un rey de niebla se alza ante ti. Su cara está vacía, como una pregunta sin respuesta.'],
        ['jefe', '¿Para qué saber, {nombre}? Saber duele. Recordar cansa. Olvida… y descansa para siempre.'],
        ['heroe', 'Recordar es lo que nos hace ser quienes somos.'],
        ['jefe', 'Entonces veamos cuánto recuerdas.'],
      ]),
      boss('c5f', 'olvido', 10),
      s('c5g', 'Sapiencia recuerda', [
        ['narrador', 'La niebla se deshace como el azúcar en el café. En todo Sapiencia, la gente recuerda de golpe: nombres, canciones, récords y cumpleaños.'],
        ['ulula', 'Lo has conseguido, {nombre}. Pero el Olvido nunca desaparece del todo. Vuelve cada vez que dejamos de preguntar.'],
        ['ulula', 'Así que sigue jugando, sigue aprendiendo… y no olvides lo más importante: ¡eres listo de verdad!'],
      ]),
    ],
  },
];

// Enemigos comunes: en los prólogos, los de su raza; en la campaña, van rotando.
const MINION_RACES = ['humano', 'elfo', 'enano', 'orco'];
let rot = 0;
for (const ch of CHAPTERS) {
  for (const n of ch.nodes) {
    if (n.type !== 'battle') continue;
    const race = ch.race || MINION_RACES[rot++ % MINION_RACES.length];
    n.enemy = { name: 'Desmemoriados', img: `/img/lore/desmemoriado-${race}.webp` };
  }
}

// Recompensas por nodo (la primera vez que se supera).
const REWARDS = {
  battle: { xp: 30, coins: 10 },
  boss: { xp: 120, coins: 50 },
  finalBoss: { xp: 400, coins: 300 },
};

module.exports = { CHAPTERS, SPEAKERS, BOSSES, MINION, REWARDS };
