# Tutoriel

Code : `src/store/tutorialSteps.ts` (parcours), `src/store/tutorialStore.ts` (session),
`src/ui/Tutorial.tsx` (affichage). Le bouton « Tutoriel », en haut du panneau, l'ouvre dès qu'un
monde est chargé.

## Principe

Une étape par fonctionnalité. Chaque étape :

| Élément    | Rôle                                                                                  |
| ---------- | ------------------------------------------------------------------------------------- |
| Cadre      | Entoure l'élément dont parle l'étape et assombrit le reste de l'écran                 |
| Fiche      | Titre, explication, consignes cochées au fur et à mesure                              |
| Consignes  | Gestes à faire dans l'application elle-même, jugés sur l'état des stores              |
| Navigation | « Précédent », « Passer » tant que les consignes ne sont pas faites, puis « Suivant » |

Le tutoriel ne bloque rien : le cadre et le voile laissent passer la souris, et le MJ manipule son
vrai monde, avec les vrais outils. Il n'existe pas de bac à sable séparé.

## Parcours

| Étape                  | Élément désigné                     | Consignes                                        |
| ---------------------- | ----------------------------------- | ------------------------------------------------ |
| Bienvenue              | —                                   | —                                                |
| La carte               | carte                               | glisser, zoomer (l'outil « Déplacer » est remis) |
| La date de campagne    | curseur de date                     | déplacer la date                                 |
| Le time-lapse          | lecture, retour au Cataclysme       | lire, mettre en pause, revenir à `t0`            |
| La vitesse des anneaux | premier anneau, puis date           | changer une vitesse, avancer la date             |
| Les coupures           | éditeur d'anneaux                   | déplacer une coupure, scinder ou fusionner       |
| Le niveau de la mer    | curseur                             | le changer                                       |
| L'affichage            | cases de failles, style, animations | en basculer une                                  |
| Relief, biome          | bouton d'outil, puis carte          | choisir l'outil, peindre                         |
| Lieux                  | bouton, carte, fiche                | choisir l'outil, poser ou ouvrir, renommer       |
| Routes, créatures      | bouton, puis carte                  | choisir l'outil, tracer                          |
| Brouillard             | bouton, puis carte                  | choisir l'outil, révéler                         |
| Image                  | bouton, puis carte                  | choisir l'outil, cadrer                          |
| Annuler et rétablir    | boutons                             | annuler, rétablir                                |
| Générer un monde       | panneau « Le monde »                | changer un réglage, sans régénérer               |
| Le fichier, fin        | panneau « Le fichier »              | —                                                |

## Jugement des consignes

Un relevé (`Probe`) de l'état des stores est pris à l'entrée de chaque étape ; chaque changement
d'un store relance le jugement sur un nouveau relevé. Une consigne est une fonction pure
`(now, start) => boolean`, testée sans navigateur.

- Les consignes se jugent **dans l'ordre** : une consigne ne compte qu'une fois les précédentes
  faites. « Mettre en pause » n'est pas acquis avant d'avoir lancé la lecture.
- Une consigne faite **le reste** : mettre en pause ne défait pas d'avoir lancé la lecture.
- Un geste sur la carte se reconnaît au compteur `commandCount` du store d'édition, augmenté à
  chaque commande empilée, et au nom de la dernière commande (`coup de pinceau`, `route tracée`…).
  Le seul nom ne suffit pas : il peut être celui d'un geste antérieur à l'étape.
- Le cadre suit la première consigne à faire ; si son élément est absent ou invisible (une fiche
  fermée), il retombe sur l'élément de l'étape, puis sur aucun.

Les éléments désignables portent un attribut `data-tutorial` (`map`, `date`, `timelapse`,
`ring-speed`, `rings`, `sea-level`, `display`, `tool-<outil>`, `tool-options`, `undo`, `world`,
`file`). Renommer ou retirer l'un d'eux casse silencieusement l'étape qui le vise : le test de bout
en bout `e2e/tutorial.spec.ts` en couvre une partie.

## Sortie

À l'ouverture, le monde est copié tel qu'il serait enregistré, tableaux de relief, de biomes et de
brouillard compris — le pinceau les réécrit en place — ainsi que les réglages hors document
(paramètres de génération, affichage, outil, cadre d'export).

| Sortie                         | Effet                                                        |
| ------------------------------ | ------------------------------------------------------------ |
| Rien n'a changé                | Fermeture directe                                            |
| « Rétablir mon monde d'avant » | Copie réadoptée, pile d'annulation vidée, autosave programmé |
| « Garder les modifications »   | Fermeture, le monde reste tel quel                           |

La pile d'annulation est vidée au rétablissement, comme après un import : ses commandes visent le
monde qu'on quitte. Le drapeau `edited` reprend sa valeur d'avant le tutoriel.

## Points ouverts

- Proposer le tutoriel d'office à la première visite.
- Étape dédiée à l'export et à l'import d'un fichier `.pangee` avec consigne : l'export télécharge
  un fichier et l'import remplace le monde, ce qu'un tutoriel ne doit pas imposer.
