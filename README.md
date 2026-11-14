# Archivage électronique — DSIC

Plateforme de gestion des archives administratives du Ministère de la Sécurité sociale, de la Prévoyance sociale et de la Solidarité nationale.

## 1. L'idée en deux phrases

Il y a **un seul super utilisateur (PHIRNEL ONGAGNA)** qui gère tout : les documents et tous les comptes. Les **consultants**, eux, n'ont **pas de tableau de bord** : après la connexion, ils arrivent directement sur une page de recherche, trouvent un document, puis peuvent le **lire** ou le **télécharger**.

## 2. Les fichiers (à garder dans le même dossier)

| Fichier | À quoi il sert |
|---|---|
| `index.html` | Les pages : connexion, interface consultant, interface super utilisateur |
| `styles.css` | L'apparence (couleurs, boutons, tableaux, téléphone, impression) |
| `script.js` | Le fonctionnement. Chaque partie est commentée en français simple |
| `logo_m.png` | Le logo du Ministère |

**Pour lancer :** ouvrir `index.html` dans Chrome, Edge ou Firefox.

## 3. Comptes et mots de passe (démonstration)

| Rôle | Nom | Identifiant | Mot de passe |
|---|---|---|---|
| Super utilisateur | PHIRNEL ONGAGNA | `phirnel` | `super2026` |
| Consultant | Consultant | `consultant` | `consult123` |

> Le super utilisateur doit changer ces mots de passe dès la première connexion (**Utilisateurs → Modifier**). Les identifiants s'écrivent en minuscules.

## 4. Ce que voit le CONSULTANT

### Écran 1 — Recherche
Après la connexion, il voit uniquement :

- **Type de document** (liste) : Note, Lettre, Lettre PR, Lettre PM
- **Mois** (liste) : Janvier à Décembre
- Bouton **Valider**
- Bouton **Annuler**

**Règle du critère unique :** on cherche soit par type, soit par mois, jamais les deux. Dès qu'un critère est choisi, l'autre liste se grise. Si on le remet à vide, l'autre se réactive.

| Bouton | Ce qu'il fait |
|---|---|
| **Valider** | Lance la recherche et ouvre la page des résultats. Si aucun critère n'est choisi, un message le demande. |
| **Annuler** | Vide les deux champs. Ne déconnecte pas. |

### Écran 2 — Résultats
- Rappel de la recherche : critère, valeur et **nombre de résultats**.
- Tableau : N°, référence, type, date, intitulé, et pour chaque document les boutons **Lire** et **Télécharger** (quand un fichier est joint).
- Le message « Aucun document trouvé » s'affiche s'il n'y a rien.

| Bouton | Ce qu'il fait |
|---|---|
| **← Retour** | Revient à la recherche **sans déconnexion**. Les choix précédents restent affichés. |
| **Annuler** | **Quitte la session** (après confirmation) et revient à la page de connexion. |
| **Imprimer la liste** | Imprime uniquement le tableau (boutons et en-tête masqués). |
| **Exporter en CSV** | Télécharge la liste des résultats, lisible dans Excel. |

### Fonctions institutionnelles ajoutées
- En-tête avec le logo du Ministère et le trait vert-jaune-rouge du drapeau, pied de page officiel.
- **Fermeture automatique de la session après 10 minutes d'inactivité** (utile sur un poste partagé).
- **Confirmation** avant toute déconnexion.
- **Journal de traçabilité** : chaque recherche, lecture et téléchargement est enregistré avec le nom de l'utilisateur, la date et l'heure.
- Identifiants protégés : un compte désactivé ne peut plus se connecter.

## 5. Ce que voit le SUPER UTILISATEUR

Un menu à gauche avec quatre pages :

| Page | Contenu |
|---|---|
| **Tableau de bord** | Total des documents, documents de l'année, répartition par type, par année et par mois, 5 derniers documents, comptes actifs, dernières activités |
| **Documents** | Recherche (texte, type, année, mois), ajout, modification, suppression, fichier joint (2 Mo max), export CSV. La référence `DGSS/SG/ANNÉE/NNN` se génère toute seule |
| **Utilisateurs** | Créer un compte, changer le nom, le rôle ou le mot de passe, activer ou désactiver, supprimer |
| **Journal d'activité** | Toutes les connexions (réussies ou échouées), recherches, ajouts, modifications, suppressions, téléchargements. Peut être vidé |

**Garde-fous :** il doit toujours rester au moins un super utilisateur actif. Le super utilisateur ne peut ni se supprimer ni se désactiver lui-même.

## 6. Tableau récapitulatif des droits

| Action | Super utilisateur | Consultant |
|---|:---:|:---:|
| Tableau de bord | Oui | Non |
| Rechercher (type ou mois) | Oui | Oui |
| Lire / télécharger un document | Oui | Oui |
| Imprimer / exporter les résultats | Oui | Oui |
| Ajouter, modifier, supprimer un document | Oui | Non |
| Gérer les comptes | Oui | Non |
| Journal d'activité | Oui | Non |

## 7. Où sont gardées les données ?

Dans le **navigateur** de l'ordinateur utilisé (`localStorage`). Cela veut dire que :
- les données ne sont pas partagées entre deux ordinateurs ;
- pour tout remettre à zéro : touche **F12** → *Application* → *Stockage local* → supprimer `ae2_users`, `ae2_docs`, `ae2_logs`, puis recharger ;
- les mots de passe sont en **clair** : acceptable pour une démonstration, **pas pour un usage réel**.

## 8. Passer en version réelle (MySQL)

1. Créer la base MySQL avec trois tables : `utilisateurs`, `documents`, `journal`.
2. Créer une API (PHP, Node.js…) qui remplace les fonctions `get`, `save` et `persist` de `script.js`.
3. **Hacher les mots de passe** (bcrypt / `password_hash`) et utiliser des sessions côté serveur. Les droits doivent être vérifiés **aussi côté serveur**.
4. Stocker les fichiers dans un dossier du serveur (la limite de 2 Mo disparaît).
5. Activer **HTTPS**.

## 9. Limites actuelles

- Pas de partage des données entre postes (stockage local).
- Mots de passe en clair, pas de blocage après plusieurs échecs.
- Fichiers limités à 2 Mo, et environ 5 Mo au total dans le navigateur.
- La recherche par mois regroupe toutes les années (la date complète est affichée dans le tableau).
