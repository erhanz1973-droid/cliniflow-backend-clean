/**
 * Getting Started with Clinifly — Help Center UI
 */
(function () {
  var DATA = window.CliniflyHelpCenterData;
  if (!DATA) return;

  function currentLang() {
    if (window.i18n && typeof window.i18n.getLang === "function") {
      return window.i18n.getLang() || "en";
    }
    return "en";
  }

  function isMissingTranslation(fullKey, value) {
    if (value == null || value === "") return true;
    var s = String(value);
    if (s === fullKey) return true;
    if (s === "helpCenter." + fullKey) return true;
    if (/^articles\.[^.]+\.how\.\d+$/.test(s)) return true;
    if (s.startsWith("helpCenter.") && s.indexOf(fullKey) !== -1) return true;
    return false;
  }

  function ht(key, fallback) {
    var fullKey = "helpCenter." + key;
    if (window.i18n && typeof window.i18n.t === "function") {
      var v = window.i18n.t(fullKey);
      if (!isMissingTranslation(fullKey, v)) return v;
    }
    return fallback;
  }

  function articleLocalePack(article) {
    var lang = currentLang();
    if (lang === "en") return null;
    var packs = window.CliniflyHelpCenterI18n;
    if (!packs || !packs[lang]) return null;
    return packs[lang][article.id] || null;
  }

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function sectionTitle(id) {
    return ht("sections." + id + ".title", id.replace(/-/g, " "));
  }

  function sectionSubtitle(id) {
    return ht("sections." + id + ".subtitle", "");
  }

  function articleTitle(article) {
    var loc = articleLocalePack(article);
    if (loc && loc.title) return loc.title;
    return ht("articles." + article.id + ".title", article.title || article.id);
  }

  function localizedField(article, field) {
    var loc = articleLocalePack(article);
    if (loc && loc[field]) return loc[field];
    return article[field] || "";
  }

  function localizedSteps(article) {
    var loc = articleLocalePack(article);
    if (loc && Array.isArray(loc.how) && loc.how.length) return loc.how;
    return article.how || [];
  }

  function localizedTips(article) {
    var loc = articleLocalePack(article);
    if (loc && Array.isArray(loc.tips) && loc.tips.length) return loc.tips;
    if (!article.tips || !article.tips.length) return [];
    return article.tips.slice();
  }

  function localizedLinkLabel(article) {
    var loc = articleLocalePack(article);
    if (loc && loc.linkLabel) return loc.linkLabel;
    if (!article.adminLinkLabel) return ht("openPage", "Open related page");
    return ht("articles." + article.id + ".linkLabel", article.adminLinkLabel);
  }

  function renderChecklist() {
    var el = document.getElementById("hcChecklist");
    if (!el) return;
    el.innerHTML = DATA.CHECKLIST.map(function (item) {
      var label = ht("checklist." + item.key, item.key);
      return (
        '<a class="hc-check-item" href="' +
        esc(item.link) +
        '">' +
        '<span class="hc-check-num">→</span> ' +
        esc(label) +
        "</a>"
      );
    }).join("");
  }

  function renderSidebar(activeSection) {
    var el = document.getElementById("hcNav");
    if (!el) return;
    el.innerHTML = DATA.SECTIONS.map(function (sec) {
      var active = sec.id === activeSection ? " active" : "";
      var count = DATA.ARTICLES.filter(function (a) {
        return a.section === sec.id;
      }).length;
      return (
        '<a href="#' +
        esc(sec.id) +
        '" class="hc-nav-item' +
        active +
        '" data-section="' +
        esc(sec.id) +
        '">' +
        '<span class="hc-nav-icon">' +
        sec.icon +
        "</span>" +
        "<span>" +
        esc(sectionTitle(sec.id)) +
        '</span><span class="hc-nav-count">' +
        count +
        "</span></a>"
      );
    }).join("");
  }

  function renderArticles(filterQuery, activeSection) {
    var el = document.getElementById("hcArticles");
    if (!el) return;
    var q = (filterQuery || "").toLowerCase().trim();
    var html = "";

    DATA.SECTIONS.forEach(function (sec) {
      if (activeSection && activeSection !== sec.id) return;
      var articles = DATA.ARTICLES.filter(function (a) {
        return a.section === sec.id;
      });
      if (q) {
        articles = articles.filter(function (a) {
          var blob =
            articleTitle(a) +
            " " +
            localizedField(a, "what") +
            " " +
            localizedField(a, "why") +
            " " +
            localizedSteps(a).join(" ");
          return blob.toLowerCase().indexOf(q) !== -1;
        });
      }
      if (!articles.length) return;

      html +=
        '<section class="hc-section" id="' +
        esc(sec.id) +
        '" data-section="' +
        esc(sec.id) +
        '">';
      html += '<div class="hc-section-head">';
      html += '<span class="hc-section-icon">' + sec.icon + "</span>";
      html += "<div><h2>" + esc(sectionTitle(sec.id)) + "</h2>";
      var sub = sectionSubtitle(sec.id);
      if (sub) html += '<p class="hc-section-sub">' + esc(sub) + "</p>";
      html += "</div></div>";

      articles.forEach(function (article) {
        html += renderArticleCard(article);
      });
      html += "</section>";
    });

    if (!html) {
      html =
        '<div class="hc-empty">' +
        esc(ht("searchNoResults", "No articles match your search. Try different words or browse the sections.")) +
        "</div>";
    }
    el.innerHTML = html;
    wireArticleToggles();
  }

  function renderArticleCard(article) {
    var steps = localizedSteps(article);
    var tips = localizedTips(article);
    var linkLabel = localizedLinkLabel(article);

    var screenshot = "";
    if (article.screenshot) {
      screenshot =
        '<figure class="hc-screenshot">' +
        '<img src="' +
        esc(article.screenshot) +
        '" alt="' +
        esc(articleTitle(article)) +
        ' screenshot" loading="lazy" />' +
        '<figcaption>' +
        esc(ht("screenshotCaption", "Example screen — your admin may look slightly different.")) +
        "</figcaption></figure>";
    }

    var tipsHtml = "";
    if (tips.length) {
      tipsHtml =
        '<div class="hc-tips"><strong>' +
        esc(ht("tipsLabel", "Tips")) +
        ":</strong><ul>" +
        tips
          .map(function (t) {
            return "<li>" + esc(t) + "</li>";
          })
          .join("") +
        "</ul></div>";
    }

    var actionHtml = "";
    if (article.adminLink) {
      var target = article.external ? ' target="_blank" rel="noopener"' : "";
      actionHtml =
        '<a class="hc-action-btn" href="' +
        esc(article.adminLink) +
        '"' +
        target +
        ">" +
        esc(linkLabel) +
        " →</a>";
    }

    return (
      '<article class="hc-article" id="' +
      esc(article.id) +
      '" data-article-id="' +
      esc(article.id) +
      '">' +
      '<button type="button" class="hc-article-toggle" aria-expanded="false">' +
      '<span class="hc-article-title">' +
      esc(articleTitle(article)) +
      "</span>" +
      '<span class="hc-chevron">▼</span>' +
      "</button>" +
      '<div class="hc-article-body" hidden>' +
      screenshot +
      '<div class="hc-block"><span class="hc-label">' +
      esc(ht("whatLabel", "What is it?")) +
      '</span><p>' +
      esc(localizedField(article, "what")) +
      "</p></div>" +
      '<div class="hc-block"><span class="hc-label">' +
      esc(ht("whyLabel", "Why should I use it?")) +
      '</span><p>' +
      esc(localizedField(article, "why")) +
      "</p></div>" +
      '<div class="hc-block"><span class="hc-label">' +
      esc(ht("howLabel", "How do I set it up?")) +
      '</span><ol class="hc-steps">' +
      steps
        .map(function (s) {
          return "<li>" + esc(s) + "</li>";
        })
        .join("") +
      "</ol></div>" +
      tipsHtml +
      actionHtml +
      "</div></article>"
    );
  }

  function wireArticleToggles() {
    document.querySelectorAll(".hc-article-toggle").forEach(function (btn) {
      if (btn.dataset.wired) return;
      btn.dataset.wired = "1";
      btn.addEventListener("click", function () {
        var body = btn.nextElementSibling;
        var open = body.hidden;
        body.hidden = !open;
        btn.setAttribute("aria-expanded", open ? "true" : "false");
        btn.classList.toggle("open", open);
        if (open) {
          var id = btn.closest(".hc-article").id;
          if (id) history.replaceState(null, "", "#" + id);
        }
      });
    });
  }

  function expandArticle(articleId) {
    var art = document.getElementById(articleId);
    if (!art) return;
    var btn = art.querySelector(".hc-article-toggle");
    var body = art.querySelector(".hc-article-body");
    if (btn && body && body.hidden) {
      body.hidden = false;
      btn.setAttribute("aria-expanded", "true");
      btn.classList.add("open");
    }
    art.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function parseHash() {
    var h = (location.hash || "").replace(/^#/, "");
    if (!h) return { section: null, article: null };
    var isArticle = DATA.ARTICLES.some(function (a) {
      return a.id === h;
    });
    if (isArticle) {
      var art = DATA.ARTICLES.find(function (a) {
        return a.id === h;
      });
      return { section: art.section, article: h };
    }
    var isSection = DATA.SECTIONS.some(function (s) {
      return s.id === h;
    });
    if (isSection) return { section: h, article: null };
    return { section: null, article: null };
  }

  function applyHash() {
    var parsed = parseHash();
    var searchEl = document.getElementById("hcSearch");
    var q = searchEl ? searchEl.value : "";
    if (q) {
      renderArticles(q, null);
    } else {
      renderArticles("", parsed.section);
      renderSidebar(parsed.section);
    }
    if (parsed.article) {
      setTimeout(function () {
        expandArticle(parsed.article);
      }, 80);
    } else if (parsed.section) {
      var sec = document.getElementById(parsed.section);
      if (sec) sec.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function init() {
    renderChecklist();
    applyHash();

    var searchEl = document.getElementById("hcSearch");
    if (searchEl) {
      searchEl.addEventListener("input", function () {
        var q = searchEl.value.trim();
        if (q) {
          renderArticles(q, null);
          renderSidebar(null);
        } else {
          applyHash();
        }
      });
    }

    document.getElementById("hcNav") &&
      document.getElementById("hcNav").addEventListener("click", function (e) {
        var a = e.target.closest(".hc-nav-item");
        if (!a) return;
        e.preventDefault();
        var sec = a.getAttribute("data-section");
        history.replaceState(null, "", "#" + sec);
        renderSidebar(sec);
        if (searchEl) searchEl.value = "";
        renderArticles("", sec);
        var secEl = document.getElementById(sec);
        if (secEl) secEl.scrollIntoView({ behavior: "smooth", block: "start" });
      });

    document.getElementById("hcShowAll") &&
      document.getElementById("hcShowAll").addEventListener("click", function (e) {
        e.preventDefault();
        if (searchEl) searchEl.value = "";
        history.replaceState(null, "", "#");
        renderSidebar(null);
        renderArticles("", null);
      });

    window.addEventListener("hashchange", applyHash);

    document.addEventListener("admin-language-changed", function () {
      applyHash();
      renderChecklist();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
