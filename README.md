# CleanTex Pro

Site vitrine professionnel de nettoyage textile a domicile avec tableau de bord admin de reception des demandes clients en temps reel.

## Stack technique
- **Backend** : Node.js + Express
- **Frontend** : HTML/CSS/JS vanilla (aucune dependance CDN)
- **Stockage** : JSON file (persistant via Render Disk)
- **Upload photos** : Multer (limite 10 Mo/photo, 4 max)

## Lancement local
npm install
node server.js
# Ouvre http://localhost:3000

## Variables d'environnement (Render)
| Variable | Description | Defaut |
|---|---|---|
| PORT | Port d'ecoute | 3000 (Render injecte 10000) |
| ADMIN_PIN | Code PIN acces /admin | 2026 |
| NODE_ENV | Environnement | production |

## Acces
- **Site client** : /
- **Login admin** : /admin-login (PIN : 2026 par defaut)
- **Dashboard admin** : /admin (protege par PIN)

## Deploiement Render
1. Fork/push ce repo sur GitHub
2. Nouveau Web Service sur render.com
3. Runtime : Node, Build : npm install, Start : node server.js
4. Ajouter un Disk : mount path /opt/render/project/src/data, 1 GB
5. Variables d'env : ADMIN_PIN=VotreCodeSecret NODE_ENV=production
