// ============================================
// A BLUFFERS GUIDE — Interactive Script
// ============================================

document.addEventListener('DOMContentLoaded', () => {

    // ---- Wireframe Globe (Canvas) ----
    const canvas = document.getElementById('globeCanvas');
    const ctx = canvas.getContext('2d');
    let width, height;
    let rotation = 0;

    function resizeCanvas() {
        width = canvas.width = window.innerWidth;
        height = canvas.height = window.innerHeight;
    }

    function drawGlobe() {
        ctx.clearRect(0, 0, width, height);
        const cx = width / 2;
        const cy = height / 2;
        const radius = Math.min(width, height) * 0.35;

        ctx.strokeStyle = '#5B5BF0';
        ctx.lineWidth = 1;

        // Longitude lines
        for (let i = 0; i < 12; i++) {
            const angle = (i / 12) * Math.PI + rotation;
            ctx.beginPath();
            for (let j = 0; j <= 60; j++) {
                const phi = (j / 60) * Math.PI * 2;
                const x = cx + radius * Math.cos(phi) * Math.sin(angle);
                const y = cy + radius * Math.sin(phi);
                if (j === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.stroke();
        }

        // Latitude lines
        for (let i = 1; i < 8; i++) {
            const lat = (i / 8) * Math.PI - Math.PI / 2;
            const r = radius * Math.cos(lat);
            const yOffset = radius * Math.sin(lat);
            ctx.beginPath();
            ctx.ellipse(cx, cy + yOffset, r, r * 0.3, 0, 0, Math.PI * 2);
            ctx.stroke();
        }

        // Outer circle
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.stroke();

        rotation += 0.003;
        requestAnimationFrame(drawGlobe);
    }

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    drawGlobe();


    // ---- Cursor Glow ----
    const cursorGlow = document.getElementById('cursorGlow');
    let mouseX = 0, mouseY = 0;

    document.addEventListener('mousemove', (e) => {
        mouseX = e.clientX;
        mouseY = e.clientY;
        cursorGlow.style.left = mouseX + 'px';
        cursorGlow.style.top = mouseY + 'px';
        cursorGlow.style.opacity = '1';
    });

    document.addEventListener('mouseleave', () => {
        cursorGlow.style.opacity = '0';
    });


    // ---- Nav Scroll Effect ----
    const nav = document.getElementById('nav');
    window.addEventListener('scroll', () => {
        if (window.scrollY > 80) {
            nav.classList.add('scrolled');
        } else {
            nav.classList.remove('scrolled');
        }
    });


    // ---- Scroll Reveal ----
    const revealElements = document.querySelectorAll(
        '.section-grid, .stats-grid, .stat-card, .artist-card, .offer-card, .pull-quote, .collab-inner, .content-showcase .section-grid, .stats-footnote'
    );

    revealElements.forEach(el => el.classList.add('reveal'));

    const revealObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
            }
        });
    }, { threshold: 0.1, rootMargin: '0px 0px -50px 0px' });

    revealElements.forEach(el => revealObserver.observe(el));


    // ---- Staggered Artist Cards ----
    const artistCards = document.querySelectorAll('.artist-card');
    const artistObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry, index) => {
            if (entry.isIntersecting) {
                setTimeout(() => {
                    entry.target.classList.add('reveal', 'visible');
                }, index * 80);
            }
        });
    }, { threshold: 0.05 });

    artistCards.forEach(card => {
        card.classList.add('reveal');
        artistObserver.observe(card);
    });


    // ---- Counter Animation ----
    const statCards = document.querySelectorAll('.stat-card[data-count]');

    const counterObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const target = parseInt(entry.target.dataset.count);
                const numEl = entry.target.querySelector('.stat-number');
                animateCount(numEl, target);
                counterObserver.unobserve(entry.target);
            }
        });
    }, { threshold: 0.5 });

    statCards.forEach(card => counterObserver.observe(card));

    function animateCount(el, target) {
        const duration = 1500;
        const start = performance.now();

        function update(now) {
            const elapsed = now - start;
            const progress = Math.min(elapsed / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 4);
            const current = Math.round(eased * target);

            el.textContent = current.toLocaleString();

            if (progress < 1) {
                requestAnimationFrame(update);
            }
        }

        requestAnimationFrame(update);
    }


    // ---- Drag to Scroll (Content Cards) ----
    const scrollContainer = document.querySelector('.content-scroll');
    let isDown = false;
    let startX;
    let scrollLeft;

    scrollContainer.addEventListener('mousedown', (e) => {
        isDown = true;
        scrollContainer.style.cursor = 'grabbing';
        startX = e.pageX - scrollContainer.offsetLeft;
        scrollLeft = scrollContainer.scrollLeft;
    });

    scrollContainer.addEventListener('mouseleave', () => {
        isDown = false;
        scrollContainer.style.cursor = 'grab';
    });

    scrollContainer.addEventListener('mouseup', () => {
        isDown = false;
        scrollContainer.style.cursor = 'grab';
    });

    scrollContainer.addEventListener('mousemove', (e) => {
        if (!isDown) return;
        e.preventDefault();
        const x = e.pageX - scrollContainer.offsetLeft;
        const walk = (x - startX) * 2;
        scrollContainer.scrollLeft = scrollLeft - walk;
    });


    // ---- Smooth Scroll for Nav Links ----
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));
            if (target) {
                target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        });
    });


    // ---- Parallax on Hero ----
    window.addEventListener('scroll', () => {
        const scrolled = window.scrollY;
        const hero = document.querySelector('.hero-content');
        if (hero && scrolled < window.innerHeight) {
            hero.style.transform = `translateY(${scrolled * 0.3}px)`;
            hero.style.opacity = 1 - (scrolled / window.innerHeight) * 0.8;
        }
    });


    // ---- Content Card Tilt Effect ----
    document.querySelectorAll('.content-card').forEach(card => {
        card.addEventListener('mousemove', (e) => {
            const rect = card.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            const centerX = rect.width / 2;
            const centerY = rect.height / 2;
            const rotateX = (y - centerY) / 20;
            const rotateY = (centerX - x) / 20;

            card.style.transform = `translateY(-8px) perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
        });

        card.addEventListener('mouseleave', () => {
            card.style.transform = 'translateY(0)';
        });
    });

});
