/**
 * ååºå¼èåæ§å¶ - ææºç«¯æ±å ¡èå
 * ä»æ§å¶æ¾ç¤ºæ ·å¼ï¼ä¸æ¶ååè½é»è¾
 */
(function() {
    function initResponsiveMenu() {
        // é¿åéå¤åå§å
        if (document.querySelector('.mobile-menu-toggle')) return;

        // åå»ºæ±å ¡èåæé®
        var toggleBtn = document.createElement('button');
        toggleBtn.className = 'mobile-menu-toggle';
        toggleBtn.innerHTML = '&#9776;';
        toggleBtn.setAttribute('aria-label', 'èå');
        document.body.insertBefore(toggleBtn, document.body.firstChild);

        // åå»ºé®ç½©å±
        var overlay = document.createElement('div');
        overlay.className = 'mobile-overlay';
        document.body.insertBefore(overlay, document.body.firstChild.nextSibling);

        // è·åå·¦ä¾§èå
        var sideMenu = document.querySelector('.layui-side');
        if (!sideMenu) return;

        // ç¹å»æ±å ¡æé® - åæ¢èå
        toggleBtn.addEventListener('click', function() {
            sideMenu.classList.toggle('open');
            overlay.classList.toggle('show');
        });

        // ç¹å»é®ç½©å± - å³é­èå
        overlay.addEventListener('click', function() {
            sideMenu.classList.remove('open');
            overlay.classList.remove('show');
        });

        // ç¹å»èåé¡¹åèªå¨å³é­èå
        var navItems = sideMenu.querySelectorAll('a');
        navItems.forEach(function(item) {
            item.addEventListener('click', function() {
                sideMenu.classList.remove('open');
                overlay.classList.remove('show');
            });
        });

        // çªå£å¤§å°ååæ¶ï¼å¤§å±æ¸é¤æ½å±ç¶æ
        window.addEventListener('resize', function() {
            if (window.innerWidth > 768) {
                sideMenu.classList.remove('open');
                overlay.classList.remove('show');
            }
        });
    }

    // DOMå è½½å®æååå§å
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initResponsiveMenu);
    } else {
        initResponsiveMenu();
    }
})();

