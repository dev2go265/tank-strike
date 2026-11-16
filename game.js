// Tank Strike 3D — real 3D with Three.js r160 (ES module via dynamic import, jsDelivr -> unpkg fallback).
// Classic script (dynamic import keeps node --check happy). All models/textures built in code.
(function () {
  'use strict';

  var WIN_KILLS = 15;
  var WORLD = { x: 32, z: 24 }; // half extents
  var CDNS = [
    'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js',
    'https://unpkg.com/three@0.160.0/build/three.module.js'
  ];

  var scoreEl = document.getElementById('hud-score');
  var killsEl = document.getElementById('hud-kills');
  var hpEl = document.getElementById('hud-hp');
  var startBtn = document.getElementById('start-btn');
  var fireBtn = document.getElementById('fire-btn');
  var sensEl = document.getElementById('sens');
  var sensVal = document.getElementById('sens-val');
  var gfxEl = document.getElementById('gfx');
  var sceneBox = document.getElementById('scene');
  var loadingEl = document.getElementById('loading');
  var errorEl = document.getElementById('load-error');

  var state = 'title';
  var score = 0, kills = 0, hp = 100;
  var best = 0;
  try { best = parseInt(localStorage.getItem('tank-strike-best') || '0', 10) || 0; } catch (e) { best = 0; }
  var muted = false, sens = 1.0;
  var keys = {};
  var mouse = { x: 0, z: 0, active: false };
  var touchDrive = { active: false, id: null, dx: 0, dy: 0 };
  var THREE = null, renderer = null, scene = null, camera = null, clock = null;
  var player = null, enemies = [], shells = [], particles = [], obstacles = [];
  var spawnTimer = 0, shakeT = 0, time = 0, exhaustT = 0;
  var raycaster = null, groundPlane = null, flashLight = null, muzzle = null;
  var gfxMode = 'auto';

  var audioCtx = null;
  function beep(freq, dur, type, vol) {
    if (muted) return;
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      var o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = type || 'sine'; o.frequency.value = freq;
      g.gain.value = vol || 0.07;
      g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
      o.connect(g); g.connect(audioCtx.destination);
      o.start(); o.stop(audioCtx.currentTime + dur);
    } catch (e) {}
  }
  function setSens(v) {
    sens = Math.max(0.5, Math.min(2, Math.round(v * 10) / 10));
    sensEl.value = String(sens);
    sensVal.textContent = sens.toFixed(1) + 'x';
  }
  sensEl.addEventListener('input', function () { setSens(parseFloat(sensEl.value)); });
  gfxEl.addEventListener('change', function () { gfxMode = gfxEl.value; applyGraphics(); });

  function updateHud() {
    scoreEl.textContent = 'Score: ' + score;
    killsEl.textContent = 'Kills: ' + kills + '/' + WIN_KILLS;
    hpEl.textContent = 'HP: ' + Math.max(0, Math.ceil(hp));
  }

  // ---------- procedural canvas textures ----------
  function canvasTex(w, h, draw, rx, ry) {
    var c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    var t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(rx || 1, ry || 1);
    t.anisotropy = 4;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  function groundTexture() {
    return canvasTex(512, 512, function (g, w, h) {
      g.fillStyle = '#1b2338'; g.fillRect(0, 0, w, h);
      for (var i = 0; i < 2600; i++) {
        g.fillStyle = 'rgba(255,255,255,' + (Math.random() * 0.05) + ')';
        g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
      }
      g.strokeStyle = 'rgba(90,140,255,0.16)'; g.lineWidth = 2;
      for (var x = 0; x <= w; x += 64) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
      for (var y = 0; y <= h; y += 64) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
      g.strokeStyle = 'rgba(55,224,139,0.25)'; g.lineWidth = 3;
      g.strokeRect(6, 6, w - 12, h - 12);
    }, 8, 6);
  }
  function buildingTexture(base, lit) {
    return canvasTex(256, 256, function (g, w, h) {
      g.fillStyle = base; g.fillRect(0, 0, w, h);
      for (var y = 16; y < h - 16; y += 36) {
        for (var x = 16; x < w - 16; x += 36) {
          g.fillStyle = Math.random() < 0.55 ? lit : 'rgba(10,14,30,0.9)';
          g.fillRect(x, y, 22, 24);
        }
      }
      g.fillStyle = 'rgba(255,255,255,0.08)';
      g.fillRect(0, 0, w, 8);
    });
  }
  function skyTexture() {
    return canvasTex(1024, 512, function (g, w, h) {
      var grad = g.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, '#0b1030'); grad.addColorStop(0.45, '#27356e');
      grad.addColorStop(0.62, '#c65f7a'); grad.addColorStop(0.75, '#2a1e4e');
      grad.addColorStop(1, '#120e26');
      g.fillStyle = grad; g.fillRect(0, 0, w, h);
      for (var i = 0; i < 220; i++) {
        g.fillStyle = 'rgba(255,255,255,' + (0.3 + Math.random() * 0.7) + ')';
        var s = Math.random() * 2 + 0.5;
        g.fillRect(Math.random() * w, Math.random() * h * 0.45, s, s);
      }
      // low sun
      var sun = g.createRadialGradient(w * 0.72, h * 0.58, 4, w * 0.72, h * 0.58, 90);
      sun.addColorStop(0, 'rgba(255,190,110,0.95)'); sun.addColorStop(0.25, 'rgba(255,140,90,0.55)');
      sun.addColorStop(1, 'rgba(255,140,90,0)');
      g.fillStyle = sun; g.fillRect(0, 0, w, h);
    });
  }

  // ---------- models ----------
  function makeTank(color, dark) {
    var grp = new THREE.Group();
    var bodyMat = new THREE.MeshStandardMaterial({ color: color, roughness: 0.45, metalness: 0.55 });
    var darkMat = new THREE.MeshStandardMaterial({ color: dark, roughness: 0.8, metalness: 0.3 });
    var trackGeo = new THREE.BoxGeometry(0.55, 0.5, 3.4);
    var l = new THREE.Mesh(trackGeo, darkMat); l.position.set(-1.05, 0.25, 0); grp.add(l);
    var r = new THREE.Mesh(trackGeo, darkMat); r.position.set(1.05, 0.25, 0); grp.add(r);
    // road wheels
    var wheelGeo = new THREE.CylinderGeometry(0.28, 0.28, 0.6, 12);
    wheelGeo.rotateZ(Math.PI / 2);
    [-1.2, 0, 1.2].forEach(function (z) {
      [-1.05, 1.05].forEach(function (x) {
        var wh = new THREE.Mesh(wheelGeo, new THREE.MeshStandardMaterial({ color: 0x11131f, roughness: 0.9 }));
        wh.position.set(x, 0.28, z); grp.add(wh);
      });
    });
    var hull = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.55, 2.9), bodyMat);
    hull.position.y = 0.75; grp.add(hull);
    var nose = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.35, 0.5), bodyMat);
    nose.position.set(0, 0.7, 1.55); grp.add(nose);
    var turret = new THREE.Group(); turret.position.y = 1.15;
    var tbox = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.5, 1.5), bodyMat);
    turret.add(tbox);
    var hatch = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.12, 16), darkMat);
    hatch.position.set(-0.25, 0.3, -0.2); turret.add(hatch);
    var barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 1.9, 12), darkMat);
    barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.05, 1.5); turret.add(barrel);
    var muzzleTip = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0x222233, emissive: 0xffaa00, emissiveIntensity: 0 }));
    muzzleTip.position.set(0, 0.05, 2.45); muzzleTip.name = 'muzzle'; turret.add(muzzleTip);
    var antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.1, 6), darkMat);
    antenna.position.set(0.5, 0.7, -0.55); turret.add(antenna);
    grp.add(turret);
    grp.traverse(function (o) { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    grp.userData.turret = turret;
    grp.userData.muzzle = muzzleTip;
    return grp;
  }
  function makeBuilding(w, h, d, x, z, base, lit) {
    var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({ map: buildingTexture(base, lit), roughness: 0.85, metalness: 0.05 }));
    m.position.set(x, h / 2, z);
    m.castShadow = true; m.receiveShadow = true;
    scene.add(m);
    obstacles.push({ x: x, z: z, hw: w / 2, hd: d / 2 });
    // roof rim glow
    var rim = new THREE.Mesh(new THREE.BoxGeometry(w + 0.15, 0.12, d + 0.15),
      new THREE.MeshStandardMaterial({ color: 0x111122, emissive: 0x37e08b, emissiveIntensity: 0.7 }));
    rim.position.set(x, h + 0.05, z); scene.add(rim);
    return m;
  }
  function makeWall(x, z, w, d) {
    var m = new THREE.Mesh(new THREE.BoxGeometry(w, 2.2, d),
      new THREE.MeshStandardMaterial({ color: 0x2a3560, roughness: 0.7, metalness: 0.2 }));
    m.position.set(x, 1.1, z); m.castShadow = true; m.receiveShadow = true;
    scene.add(m);
    obstacles.push({ x: x, z: z, hw: w / 2, hd: d / 2 });
  }

  function blocked(x, z, r) {
    if (Math.abs(x) > WORLD.x - r || Math.abs(z) > WORLD.z - r) return true;
    for (var i = 0; i < obstacles.length; i++) {
      var o = obstacles[i];
      if (Math.abs(x - o.x) < o.hw + r && Math.abs(z - o.z) < o.hd + r) return true;
    }
    return false;
  }
  function burst(x, y, z, color, n, speed) {
    for (var i = 0; i < n; i++) {
      var p = getParticle();
      p.mesh.position.set(x, y, z);
      var a = Math.random() * Math.PI * 2, b = Math.random() * Math.PI - Math.PI / 2;
      var sp = (speed || 6) * (0.4 + Math.random());
      p.vel.set(Math.cos(a) * Math.cos(b) * sp, Math.abs(Math.sin(b)) * sp + 2, Math.sin(a) * Math.cos(b) * sp);
      p.life = 0.5 + Math.random() * 0.5; p.t = 0;
      p.mesh.material.color.setHex(color);
      p.mesh.visible = true;
    }
  }
  var particlePool = [];
  function getParticle() {
    for (var i = 0; i < particlePool.length; i++) if (!particlePool[i].mesh.visible) return particlePool[i];
    var mesh = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffffff }));
    mesh.visible = false; scene.add(mesh);
    var p = { mesh: mesh, vel: new THREE.Vector3(), life: 0, t: 0 };
    particlePool.push(p);
    return p;
  }

  function spawnEnemy() {
    var spots = [[-28, -20], [28, -20], [-28, 8], [28, 8]];
    var s = spots[Math.floor(Math.random() * spots.length)];
    var level = 1 + Math.floor(kills / 5);
    var mesh = makeTank(0xff4455, 0x5c1010);
    mesh.position.set(s[0], 0, s[1]);
    scene.add(mesh);
    enemies.push({
      mesh: mesh, x: s[0], z: s[1], heading: Math.atan2(player.x - s[0], player.z - s[1]),
      r: 1.6, hp: 60, speed: 5 + level * 0.8 + Math.random(),
      shoot: 1.2 + Math.random() * 1.2, wobble: Math.random() * Math.PI * 2
    });
  }
  function fireShell(x, y, z, heading, friendly) {
    var mesh = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10),
      new THREE.MeshBasicMaterial({ color: friendly ? 0xffd166 : 0xff6b6b }));
    mesh.position.set(x + Math.sin(heading) * 2.2, y, z + Math.cos(heading) * 2.2);
    scene.add(mesh);
    shells.push({ mesh: mesh, vx: Math.sin(heading) * 30, vz: Math.cos(heading) * 30, friendly: friendly, life: 2.5 });
    beep(friendly ? 220 : 160, 0.08, 'square', friendly ? 0.07 : 0.05);
  }

  function reset() {
    score = 0; kills = 0; hp = 100;
    enemies.forEach(function (e) { scene.remove(e.mesh); });
    shells.forEach(function (s) { scene.remove(s.mesh); });
    enemies = []; shells = [];
    particlePool.forEach(function (p) { p.mesh.visible = false; });
    spawnTimer = 0.5; shakeT = 0;
    player.x = 0; player.z = 18; player.heading = Math.PI; player.turret = Math.PI; player.cooldown = 0;
    player.mesh.position.set(0, 0, 18); player.mesh.rotation.y = Math.PI;
    updateHud();
  }
  function startGame() { if (!THREE) return; reset(); state = 'playing'; startBtn.textContent = 'Restart'; loadingEl.classList.add('hidden'); beep(520, 0.12, 'square', 0.06); }
  function endGame(won) {
    state = won ? 'won' : 'over';
    if (score > best) { best = score; try { localStorage.setItem('tank-strike-best', String(best)); } catch (e) {} }
    if (won) { beep(660, 0.15, 'sine', 0.09); setTimeout(function () { beep(990, 0.25, 'sine', 0.09); }, 160); }
    else beep(140, 0.4, 'sawtooth', 0.08);
  }

  function update(dt) {
    time += dt;
    if (player.cooldown > 0) player.cooldown -= dt;
    if (shakeT > 0) shakeT -= dt;
    var turn = 0, fwd = 0;
    if (keys.ArrowLeft || keys.a) turn -= 1;
    if (keys.ArrowRight || keys.d) turn += 1;
    if (keys.ArrowUp || keys.w) fwd += 1;
    if (keys.ArrowDown || keys.s) fwd -= 1;
    if (touchDrive.active) { turn += touchDrive.dx; fwd += -touchDrive.dy; }
    player.heading += turn * 2.6 * sens * dt;
    if (fwd) {
      var nx = player.x + Math.sin(player.heading) * fwd * 13 * dt;
      var nz = player.z + Math.cos(player.heading) * fwd * 13 * dt;
      if (!blocked(nx, player.z, 1.6)) player.x = nx;
      if (!blocked(player.x, nz, 1.6)) player.z = nz;
    }
    player.mesh.position.set(player.x, 0, player.z);
    player.mesh.rotation.y = player.heading;
    // turret aim
    if (mouse.active && !touchDrive.active) {
      player.turret = Math.atan2(mouse.x - player.x, mouse.z - player.z);
    } else if (touchDrive.active && enemies.length) {
      var be = null, bd = 1e9;
      enemies.forEach(function (e) {
        var d = (e.x - player.x) * (e.x - player.x) + (e.z - player.z) * (e.z - player.z);
        if (d < bd) { bd = d; be = e; }
      });
      if (be) player.turret = Math.atan2(be.x - player.x, be.z - player.z);
    }
    player.mesh.userData.turret.rotation.y = player.turret - player.heading;

    exhaustT -= dt;
    if (fwd && exhaustT <= 0) {
      exhaustT = 0.09;
      burst(player.x - Math.sin(player.heading) * 1.6, 0.4, player.z - Math.cos(player.heading) * 1.6, 0x8899aa, 1, 2);
    }

    spawnTimer -= dt;
    if (spawnTimer <= 0 && enemies.length < 4) {
      spawnEnemy(); spawnTimer = Math.max(0.9, 2.2 - kills * 0.07); updateHud();
    }
    enemies.forEach(function (en) {
      var dx = player.x - en.x, dz = player.z - en.z;
      var dist = Math.sqrt(dx * dx + dz * dz) || 1;
      var want = Math.atan2(dx, dz);
      var diff = want - en.heading;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      en.heading += Math.max(-1.6 * dt, Math.min(1.6 * dt, diff));
      en.wobble += dt * 2;
      if (dist > 11) {
        var ex = en.x + Math.sin(en.heading) * en.speed * dt + Math.cos(en.wobble) * 0.8 * dt;
        var ez = en.z + Math.cos(en.heading) * en.speed * dt + Math.sin(en.wobble) * 0.8 * dt;
        if (!blocked(ex, en.z, 1.6)) en.x = ex;
        if (!blocked(en.x, ez, 1.6)) en.z = ez;
      }
      en.mesh.position.set(en.x, 0, en.z);
      en.mesh.rotation.y = en.heading;
      en.mesh.userData.turret.rotation.y = 0;
      en.shoot -= dt;
      if (en.shoot <= 0 && dist < 42) {
        en.shoot = 1.7 + Math.random() * 0.9;
        fireShell(en.x, 1.2, en.z, en.heading, false);
        en.mesh.userData.muzzle.material.emissiveIntensity = 3;
        setTimeout(function () { en.mesh.userData.muzzle.material.emissiveIntensity = 0; }, 80);
      }
    });

    for (var s = shells.length - 1; s >= 0; s--) {
      var sh = shells[s];
      sh.mesh.position.x += sh.vx * dt;
      sh.mesh.position.z += sh.vz * dt;
      sh.life -= dt;
      var px = sh.mesh.position.x, pz = sh.mesh.position.z;
      var dead = sh.life <= 0 || Math.abs(px) > WORLD.x || Math.abs(pz) > WORLD.z || blocked(px, pz, 0.2);
      if (!dead && sh.friendly) {
        for (var k = enemies.length - 1; k >= 0; k--) {
          var en2 = enemies[k];
          var ddx = px - en2.x, ddz = pz - en2.z;
          if (ddx * ddx + ddz * ddz < (0.2 + 1.6) * (0.2 + 1.6)) {
            en2.hp -= 34; dead = true;
            burst(px, 1, pz, 0xffd166, 8, 5);
            if (en2.hp <= 0) {
              burst(en2.x, 1, en2.z, 0xff6b6b, 26, 9);
              burst(en2.x, 1, en2.z, 0xffd166, 14, 7);
              flashLight.position.set(en2.x, 4, en2.z); flashLight.intensity = 60;
              setTimeout(function () { flashLight.intensity = 0; }, 120);
              shakeT = 0.25;
              scene.remove(en2.mesh);
              enemies.splice(k, 1);
              kills += 1; score += 100;
              beep(520, 0.1, 'sine', 0.08);
              updateHud();
              if (kills >= WIN_KILLS) { endGame(true); return; }
            }
            break;
          }
        }
      }
      if (!dead && !sh.friendly) {
        var pdx = px - player.x, pdz = pz - player.z;
        if (pdx * pdx + pdz * pdz < (0.2 + 1.6) * (0.2 + 1.6)) {
          dead = true; hp -= 34; shakeT = 0.3;
          burst(player.x, 1, player.z, 0xff6b6b, 20, 8);
          beep(120, 0.2, 'sawtooth', 0.09);
          updateHud();
          if (hp <= 0) { hp = 0; updateHud(); endGame(false); return; }
        }
      }
      if (dead) { scene.remove(sh.mesh); shells.splice(s, 1); }
    }
    particlePool.forEach(function (p) {
      if (!p.mesh.visible) return;
      p.t += dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      p.vel.y -= 6 * dt;
      if (p.t >= p.life || p.mesh.position.y < 0.05) p.mesh.visible = false;
    });
  }

  function drawOverlay(text, sub, color) {
    // 2D text via DOM overlay is handled by state; 3D scene keeps a simple HUD sprite approach:
    // Instead, draw end screens with the HTML overlay element reused as a text layer.
    var el = document.getElementById('end-screen');
    if (!el) {
      el = document.createElement('div');
      el.id = 'end-screen'; el.className = 'overlay';
      sceneBox.appendChild(el);
    }
    el.innerHTML = '<div style="color:' + color + ';font-size:44px">' + text + '</div><div class="sub">' + sub + '</div>';
    el.classList.remove('hidden');
  }
  function hideOverlay() {
    var el = document.getElementById('end-screen');
    if (el) el.classList.add('hidden');
  }

  function animate() {
    requestAnimationFrame(animate);
    var dt = Math.min(0.05, clock.getDelta());
    if (state === 'playing') update(dt);
    // camera follow with shake
    var cx = player.x + (Math.random() - 0.5) * (shakeT > 0 ? 0.7 : 0);
    var cz = player.z + 20 + (Math.random() - 0.5) * (shakeT > 0 ? 0.7 : 0);
    camera.position.lerp(new THREE.Vector3(cx, 30, cz), 0.12);
    camera.lookAt(player.x, 0, player.z - 2);
    if (state === 'title') {
      camera.position.set(0, 34, 26);
      camera.lookAt(0, 0, 0);
      // idle orbit for the title backdrop
      var a = time * 0.05;
      camera.position.set(Math.sin(a) * 26, 30, Math.cos(a) * 26);
      camera.lookAt(0, 0, 0);
      time += dt;
    }
    if (state === 'won') drawOverlay('YOU WIN!', '15 tanks destroyed — Score: ' + score + ' • Best: ' + best + '<br>Press Enter or tap Play to go again', '#37e08b');
    else if (state === 'over') drawOverlay('GAME OVER', 'Destroyed after ' + kills + ' kills — Score: ' + score + ' • Best: ' + best + '<br>Press Enter or tap Play to try again', '#ff6b6b');
    else if (state === 'paused') drawOverlay('PAUSED', 'Press P to keep fighting', '#ffffff');
    else hideOverlay();
    renderer.render(scene, camera);
  }

  function applyGraphics() {
    if (!renderer) return;
    var small = window.innerWidth < 700;
    var ultra = gfxMode === 'ultra' || (gfxMode === 'auto' && !small);
    var low = gfxMode === 'low';
    renderer.setPixelRatio(low ? 1 : Math.min(window.devicePixelRatio || 1, ultra ? 2 : 1.5));
    renderer.shadowMap.enabled = !low;
    var size = low ? 1024 : (ultra ? 2048 : 1024);
    if (renderer.shadowMap.enabled && scene) {
      scene.traverse(function (o) { if (o.isDirectionalLight) { o.shadow.mapSize.set(size, size); if (o.shadow.map) { o.shadow.map.dispose(); o.shadow.map = null; } } });
    }
    onResize();
  }
  function onResize() {
    if (!renderer) return;
    var w = sceneBox.clientWidth, h = sceneBox.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function init(t) {
    THREE = t;
    raycaster = new THREE.Raycaster();
    groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    sceneBox.appendChild(renderer.domElement);
    scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x1a2340, 55, 110);
    camera = new THREE.PerspectiveCamera(55, 4 / 3, 0.1, 300);
    camera.position.set(0, 30, 26);
    clock = new THREE.Clock();

    // sky dome
    var sky = new THREE.Mesh(new THREE.SphereGeometry(140, 32, 20),
      new THREE.MeshBasicMaterial({ map: skyTexture(), side: THREE.BackSide, fog: false }));
    scene.add(sky);
    // lights
    scene.add(new THREE.HemisphereLight(0x8fb4ff, 0x1a1410, 0.75));
    var sun = new THREE.DirectionalLight(0xffd9a0, 2.2);
    sun.position.set(28, 42, 18);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -45; sun.shadow.camera.right = 45;
    sun.shadow.camera.top = 45; sun.shadow.camera.bottom = -45;
    sun.shadow.camera.far = 120; sun.shadow.bias = -0.0004;
    scene.add(sun);
    flashLight = new THREE.PointLight(0xffaa33, 0, 30);
    flashLight.position.set(0, 4, 0);
    scene.add(flashLight);

    // ground
    var ground = new THREE.Mesh(new THREE.PlaneGeometry(WORLD.x * 2 + 16, WORLD.z * 2 + 16),
      new THREE.MeshStandardMaterial({ map: groundTexture(), roughness: 0.95, metalness: 0 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // arena walls + cover buildings
    makeWall(0, -WORLD.z - 1, WORLD.x * 2 + 4, 2);
    makeWall(0, WORLD.z + 1, WORLD.x * 2 + 4, 2);
    makeWall(-WORLD.x - 1, 0, 2, WORLD.z * 2 + 4);
    makeWall(WORLD.x + 1, 0, 2, WORLD.z * 2 + 4);
    makeBuilding(9, 7, 5, -16, -12, '#2c3a5e', '#ffd166');
    makeBuilding(9, 6, 5, 16, -12, '#3a2c5e', '#7df0ff');
    makeBuilding(9, 7, 5, -16, 10, '#24344f', '#ffd166');
    makeBuilding(9, 6, 5, 16, 10, '#33244f', '#7df0ff');
    makeBuilding(7, 9, 7, 0, 0, '#2e2a55', '#ff9f6b');
    makeBuilding(5, 4, 4, -26, 0, '#26344f', '#ffd166');
    makeBuilding(5, 4, 4, 26, -2, '#26344f', '#7df0ff');

    // player tank
    var mesh = makeTank(0x37e08b, 0x0d5c33);
    mesh.position.set(0, 0, 18);
    scene.add(mesh);
    player = { mesh: mesh, x: 0, z: 18, heading: Math.PI, turret: Math.PI, cooldown: 0, r: 1.6 };
    muzzle = mesh.userData.muzzle;

    // title-screen backdrop enemies (decorative, cleared on start)
    for (var i = 0; i < 3; i++) {
      var em = makeTank(0xff4455, 0x5c1010);
      em.position.set(-14 + i * 14, 0, -14);
      scene.add(em);
      enemies.push({ mesh: em, x: -14 + i * 14, z: -14, heading: 0, r: 1.6, hp: 60, speed: 0, shoot: 99, wobble: 0 });
    }

    applyGraphics();
    window.addEventListener('resize', onResize);
    loadingEl.classList.add('hidden');
    animate();
  }

  async function loadThree() {
    for (var i = 0; i < CDNS.length; i++) {
      try {
        var mod = await import(CDNS[i]);
        if (mod && (mod.Scene || mod.default)) return mod;
      } catch (e) { /* try next CDN */ }
    }
    return null;
  }

  // input
  function toGround(e) {
    var rect = renderer ? renderer.domElement.getBoundingClientRect() : sceneBox.getBoundingClientRect();
    var nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    var ny = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    if (!raycaster || !camera) return;
    raycaster.setFromCamera({ x: nx, y: ny }, camera);
    var hit = raycaster.ray.intersectPlane(groundPlane, new THREE.Vector3());
    if (hit) { mouse.x = hit.x; mouse.z = hit.z; mouse.active = true; }
  }
  document.addEventListener('mousemove', function (e) { if (state === 'playing') toGround(e); });
  document.addEventListener('mousedown', function (e) {
    if (!THREE) return;
    if (state === 'title' || state === 'won' || state === 'over') { startGame(); return; }
    if (state !== 'playing') return;
    toGround(e);
    if (player.cooldown <= 0) {
      player.cooldown = 0.35;
      fireShell(player.x, 1.2, player.z, player.turret, true);
      player.mesh.userData.muzzle.material.emissiveIntensity = 3;
      setTimeout(function () { player.mesh.userData.muzzle.material.emissiveIntensity = 0; }, 80);
    }
  });
  // touch drive
  var touchStart = null;
  sceneBox.addEventListener('touchstart', function (e) {
    e.preventDefault();
    if (state === 'title' || state === 'won' || state === 'over') { startGame(); return; }
    var t = e.changedTouches[0];
    touchStart = { x: t.clientX, y: t.clientY };
    touchDrive.active = true; touchDrive.id = t.identifier; touchDrive.dx = 0; touchDrive.dy = 0;
  }, { passive: false });
  sceneBox.addEventListener('touchmove', function (e) {
    e.preventDefault();
    for (var i = 0; i < e.changedTouches.length; i++) {
      var t = e.changedTouches[i];
      if (touchDrive.active && t.identifier === touchDrive.id) {
        touchDrive.dx = Math.max(-1, Math.min(1, (t.clientX - touchStart.x) / 60));
        touchDrive.dy = Math.max(-1, Math.min(1, (t.clientY - touchStart.y) / 60));
      }
    }
  }, { passive: false });
  sceneBox.addEventListener('touchend', function (e) {
    for (var i = 0; i < e.changedTouches.length; i++) {
      if (touchDrive.active && e.changedTouches[i].identifier === touchDrive.id) {
        touchDrive.active = false; touchDrive.dx = 0; touchDrive.dy = 0;
      }
    }
  });

  window.addEventListener('keydown', function (e) {
    keys[e.key.length === 1 ? e.key.toLowerCase() : e.key] = true;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (state === 'title' || state === 'won' || state === 'over') startGame();
      else if (e.key === ' ' && state === 'playing' && player && player.cooldown <= 0) {
        player.cooldown = 0.35;
        fireShell(player.x, 1.2, player.z, player.turret, true);
      }
    }
    if (e.key === '[') setSens(sens - 0.1);
    if (e.key === ']') setSens(sens + 0.1);
    if ((e.key === 'p' || e.key === 'P') && (state === 'playing' || state === 'paused')) {
      state = state === 'playing' ? 'paused' : 'playing';
      if (state === 'paused') drawOverlay('PAUSED', 'Press P to keep fighting', '#ffffff');
      else hideOverlay();
    }
    if (e.key === 'm' || e.key === 'M') muted = !muted;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].indexOf(e.key) >= 0) e.preventDefault();
  });
  window.addEventListener('keyup', function (e) { keys[e.key.length === 1 ? e.key.toLowerCase() : e.key] = false; });
  startBtn.addEventListener('click', function () {
    if (!THREE) { loadThree().then(function (m) { if (m) init(m); else errorEl.classList.remove('hidden'); }); return; }
    startGame();
  });
  fireBtn.addEventListener('click', function (e) {
    e.preventDefault();
    if (state === 'playing' && player && player.cooldown <= 0) {
      player.cooldown = 0.35;
      fireShell(player.x, 1.2, player.z, player.turret, true);
    }
  });

  setSens(1.0);
  updateHud();
  loadThree().then(function (mod) {
    if (mod) init(mod);
    else { loadingEl.classList.add('hidden'); errorEl.classList.remove('hidden'); }
  });
})();
