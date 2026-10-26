Remplace tout le contenu de **`public/app.js`** par ceci :

```javascript
const app = document.querySelector('#app');
let me = null;
let tab = 'services';

const discord = 'https://discord.gg/dX6ZSfGg9E';

const stops = [
  'Amboise',
  'Quartier des Tilleuls',
  'La Bondonnière',
  'Amboise Nord',
  'Circuit Karting',
  'Amboise Sud',
  'Domaine viticole',
  'Camp de bûcheron',
  'Gare Routière'
];

const esc = value => String(value ?? '').replace(
  /[&<>"']/g,
  character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]
);

const is = role => me?.roles.includes(role);

function toast(message) {
  const element = document.querySelector('#toast');
  element.textContent = message;
  element.style.display = 'block';

  setTimeout(() => {
    element.style.display = 'none';
  }, 5000);
}

async function api(path, data) {
  const response = await fetch(
    '/api/' + path,
    data
      ? {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': me?.csrf || ''
          },
          body: JSON.stringify(data)
        }
      : {}
  );

  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.error || 'Erreur serveur');
  }

  return result;
}

const link = (text, url = discord) => `
  <a class="button" href="${url}" target="_blank" rel="noopener">
    ${text} ↗
  </a>
`;

const title = (heading, description) => `
  <div class="eyebrow">Régie des transports d’Amboise</div>
  <h1>${heading}</h1>
  <p class="muted">${description}</p>
`;

async function render() {
  try {
    const page = location.hash.slice(1) || 'accueil';

    if (page === 'personnel') {
      return await personnel();
    }

    const pub = await api('public');
    const state = pub.active ? 'En service' : 'Hors service';

    const status = `
      <span class="badge ${pub.active ? 'green' : ''}">
        ${state}
      </span>
    `;

    const route = `
      <section class="card route">
        <div class="routehead">
          <span class="line">1</span>
          <div>
            <h3>Amboise ↔ Gare Routière</h3>
            ${status}
          </div>
        </div>

        <p class="muted">
          Départs selon les chauffeurs disponibles, sans horaires fixes.
        </p>

        <ul class="stops">
          ${stops.map(stop => `<li>${esc(stop)}</li>`).join('')}
        </ul>
      </section>
    `;

    if (page === 'accueil') {
      app.innerHTML = `
        <section class="hero">
          <div class="eyebrow">Votre réseau • Amboise</div>
          <h1>Amboise,<br><span>on vous y emmène.</span></h1>

          <p>
            Retrouvez votre ligne, consultez l’état du service
            et préparez votre prochain trajet avec la RTA.
          </p>

          <a class="button" href="#lignes">
            Découvrir la ligne 1 →
          </a>
        </section>

        <div class="grid">
          <a class="card" href="#lignes">
            <div class="eyebrow">Le réseau</div>
            <h3>Ligne 1</h3>
            <p>Amboise ↔ Gare Routière</p>
            ${status}
          </a>

          <a class="card" href="#tarifs">
            <div class="eyebrow">Voyagez simplement</div>
            <div class="number">3 €</div>
            Le ticket aller simple
          </a>

          <a class="card" href="#services">
            <div class="eyebrow">Rejoignez l’équipe</div>
            <h3>La route commence ici.</h3>
            <p>Candidatures sur notre Discord →</p>
          </a>
        </div>

        <div class="bar">
          <h2>Votre ligne, en un coup d’œil</h2>
          <a href="#trafic">Voir les infos trafic →</a>
        </div>

        ${route}
      `;
    } else if (page === 'lignes') {
      app.innerHTML =
        title(
          'Le réseau',
          'Une ligne pour relier les lieux clés d’Amboise.'
        ) + route;
    } else if (page === 'tarifs') {
      app.innerHTML =
        title(
          'À chacun son trajet.',
          'Achetez vos tickets uniquement en station.'
        ) + `
          <div class="grid">
            <section class="card">
              <h3>Aller simple</h3>
              <div class="number">3 €</div>
              <p>Un trajet sur le réseau RTA.</p>
            </section>

            <section class="card">
              <h3>Aller-retour</h3>
              <div class="number">6 €</div>
              <p>Votre trajet dans les deux sens.</p>
            </section>

            <section class="card">
              <h3>Où acheter ?</h3>
              <p>Tickets disponibles en station.</p>
            </section>
          </div>
        `;
    } else if (page === 'trafic') {
      app.innerHTML =
        title(
          'Info trafic',
          'L’état du service est calculé à partir des prises de service sur la ligne 1.'
        ) + `
          <section class="card">
            <span class="line">1</span>
            Amboise ↔ Gare Routière
            ${status}
          </section>
        ` + pub.traffic.map(row => `
          <article class="card">${richBody(row)}</article>
        `).join('');
    } else if (page === 'amendes') {
      app.innerHTML =
        title(
          'Amendes et régularisation',
          'Consultez les informations publiées par la direction.'
        ) + (
          pub.fares.length
            ? pub.fares.map(row => `
                <article class="card">${richBody(row)}</article>
              `).join('')
            : `
                <div class="notice">
                  La grille des amendes et les règles de majoration
                  seront publiées par la direction.
                  Aucun montant ni pourcentage n’est appliqué par défaut.
                </div>
              `
        );
    } else {
      app.innerHTML =
        title(
          'À votre service.',
          'Une question, un objet perdu ou envie de nous rejoindre ?'
        ) + `
          <div class="grid">
            ${['Contact', 'Objets perdus', 'Recrutement'].map(name => `
              <section class="card">
                <h3>${name}</h3>
                <p>Retrouvez notre équipe sur Discord.</p>
                ${link('Ouvrir Discord')}
              </section>
            `).join('')}
          </div>

          <a href="#amendes">
            Consulter les amendes et régularisations →
          </a>
        `;
    }
  } catch (error) {
    app.innerHTML = `
      <div class="notice">
        ${esc(error.message)}.
        Vérifiez le démarrage du serveur et la configuration Firebase.
      </div>
    `;
  }
}

async function personnel() {
  me = await api('me');

  if (!me) {
    app.innerHTML =
      title(
        'Espace personnel',
        'Chauffeurs, mécanique, contrôleurs et direction.'
      ) + `
        <section class="card">
          <h2>Votre équipe. Votre espace.</h2>

          <p>
            Connectez-vous avec Discord.
            Votre accès dépend de vos rôles sur le serveur RTA.
          </p>

          <a class="button" href="/auth/discord">
            Se connecter avec Discord →
          </a>
        </section>
      `;

    return;
  }

  const tabs = [
    'services',
    'vehicles',
    'reports',
    'planning',
    'instructions',
    'messages'
  ];

  if (is('controller') || is('director')) {
    tabs.push('fines');
  }

  if (is('director')) {
    tabs.push('traffic', 'fares');
  }

  const labels = {
    services: 'Prise de service',
    vehicles: 'Parc & mécanique',
    reports: 'Rapports / incidents',
    planning: 'Planning',
    instructions: 'Consignes',
    messages: 'Messagerie',
    fines: 'Amendes',
    traffic: 'Infos trafic',
    fares: 'Grille & majorations'
  };

  if (!tabs.includes(tab)) {
    tab = tabs[0];
  }

  app.innerHTML = `
    <div
      role="alert"
      style="
        background:#fff3cd;
        color:#664d03;
        border-left:5px solid #ff484b;
        padding:15px 20px;
        border-radius:10px;
        margin-bottom:20px;
      "
    >
      ⚠️ <strong>Décalage horaire :</strong>
      tous les horaires affichés dans l’espace employé ont une heure
      de retard. Ajoutez <strong>1 heure</strong> pour connaître
      l’heure réelle.
    </div>

    <div class="bar">
      <div>
        <div class="eyebrow">Espace personnel</div>
        <h2>Bonjour, ${esc(me.name)}.</h2>

        <span class="muted">
          ${me.roles.map(esc).join(' · ')}
        </span>
      </div>

      <button id="logout" class="secondary">
        Déconnexion
      </button>
    </div>

    <div class="tabs">
      ${tabs.map(name => `
        <button
          data-tab="${name}"
          class="${tab === name ? 'active' : ''}"
        >
          ${labels[name]}
        </button>
      `).join('')}
    </div>

    <section id="panel" class="card"></section>
  `;

  document.querySelector('#logout').onclick = async () => {
    try {
      await api('logout', {});
      await render();
    } catch (error) {
      toast(error.message);
    }
  };

  document.querySelectorAll('[data-tab]').forEach(button => {
    button.onclick = () => {
      tab = button.dataset.tab;
      personnel().catch(error => toast(error.message));
    };
  });

  const panel = document.querySelector('#panel');
  const rows = await api(tab);

  if (tab === 'services') {
    const vehicles = await api('vehicles');
    const active = rows.find(service => !service.end);

    panel.innerHTML = active
      ? `
          <h3>Service en cours</h3>
          <p>${esc(active.plate)} · ${esc(active.start)}</p>
          <button id="end">Terminer mon service</button>
        `
      : `
          <h3>Commencer mon service</h3>

          <form>
            <label>
              Véhicule

              <select name="plate">
                ${vehicles.filter(vehicle =>
                  vehicle.available && (
                    vehicle.plate === 'EH-332-ZH'
                      ? is('mechanic') || is('director')
                      : is('driver') || is('director')
                  )
                ).map(vehicle => `
                  <option>${esc(vehicle.plate)}</option>
                `).join('')}
              </select>
            </label>

            <button>Prendre mon service</button>
          </form>
        `;

    panel.innerHTML += `
      <h3>Historique</h3>

      <div class="scroll">
        <table>
          <tr>
            <th>Agent</th>
            <th>Véhicule</th>
            <th>Début</th>
            <th>Fin</th>
          </tr>

          ${rows.map(service => `
            <tr>
              <td>${esc(service.name)}</td>
              <td>${esc(service.plate)}</td>
              <td>${esc(service.start)}</td>
              <td>${esc(service.end || 'En cours')}</td>
            </tr>
          `).join('')}
        </table>
      </div>
    `;

    if (active) {
      document.querySelector('#end').onclick = () =>
        save('services', { action: 'end' });
    } else {
      bindForm('services');
    }
  } else if (tab === 'vehicles') {
    panel.innerHTML = `
      <h3>Parc RTA</h3>

      <div class="scroll">
        <table>
          <tr>
            <th>Véhicule</th>
            <th>Immatriculation</th>
            <th>État</th>
            <th></th>
          </tr>

          ${rows.map(vehicle => `
            <tr>
              <td>${esc(vehicle.type)}</td>
              <td>${esc(vehicle.plate)}</td>
              <td>
                ${vehicle.available ? 'Disponible' : 'Indisponible'}
              </td>
              <td>
                ${
                  is('mechanic') || is('director')
                    ? `
                        <button
                          data-plate="${esc(vehicle.plate)}"
                          data-state="${!vehicle.available}"
                        >
                          ${
                            vehicle.available
                              ? 'Immobiliser'
                              : 'Remettre en circulation'
                          }
                        </button>
                      `
                    : ''
                }
              </td>
            </tr>
          `).join('')}
        </table>
      </div>
    `;

    panel.querySelectorAll('[data-plate]').forEach(button => {
      button.onclick = () => save('vehicles', {
        plate: button.dataset.plate,
        available: button.dataset.state === 'true'
      });
    });
  } else if (tab === 'fines') {
    panel.innerHTML = `
      <h3>Enregistrer une amende</h3>

      <form>
        ${[
          ['name', 'Nom et prénom RP', 'text'],
          ['phone', 'Téléphone RP', 'tel'],
          ['reason', 'Infraction', 'text'],
          ['amount', 'Montant (€)', 'number'],
          ['delivery', 'Date de remise au voyageur', 'date']
        ].map(([name, label, type]) => `
          <label>
            ${label}
            <input
              required
              name="${name}"
              type="${type}"
              ${type === 'number' ? 'min="0.01" step="0.01"' : ''}
            >
          </label>
        `).join('')}

        <button>Enregistrer</button>
      </form>

      <h3>Suivi des amendes</h3>

      <div class="notice">
        Les majorations automatiques ne sont pas activées :
        les délais et pourcentages doivent encore être définis.
      </div>

      ${rows.map(fine => `
        <article class="card">
          <strong>${esc(fine.name)}</strong>
          · ${esc(fine.phone)}

          <p>
            ${esc(fine.reason)} — ${esc(fine.amount)} €
            <br>
            Remise : ${esc(fine.delivery)}
          </p>

          <span class="badge">
            ${fine.paid ? 'Payée' : 'À régler'}
          </span>

          ${
            !fine.paid && is('director')
              ? `
                  <button data-paid="${esc(fine.id)}">
                    Marquer payée
                  </button>
                `
              : ''
          }
        </article>
      `).join('')}
    `;

    bindForm('fines');

    panel.querySelectorAll('[data-paid]').forEach(button => {
      button.onclick = () => save('fines', {
        action: 'paid',
        id: button.dataset.paid
      });
    });
  } else {
    renderPublications(panel, rows, tab, labels[tab]);
  }
}

function bindForm(kind) {
  const form = document.querySelector('#panel form');

  if (form) {
    form.onsubmit = event => {
      event.preventDefault();
      save(kind, Object.fromEntries(new FormData(form)));
    };
  }
}

async function save(kind, data) {
  try {
    await api(kind, data);
    toast('Enregistré');
    await personnel();
  } catch (error) {
    toast(error.message);
  }
}

window.addEventListener('hashchange', render);
render();

const auth = new URLSearchParams(location.search).get('auth');

if (auth) {
  toast({
    configuration: 'Le secret Discord doit être configuré sur le serveur.',
    denied: 'Aucun rôle RTA autorisé sur ce compte.',
    error: 'Connexion Discord impossible. Vérifiez la configuration.'
  }[auth] || 'Connexion impossible');
}
```
