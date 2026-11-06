/* Portfolio filters. The project cards remain in the HTML so the work is
   available to search engines and visitors even when JavaScript is disabled.
   To add a project, duplicate one .portfolio-card in portfolio.html and set
   data-category to restoration, retouching or compositing. */
(function () {
  'use strict';
  var grid = document.querySelector('[data-portfolio-grid]');
  if (!grid) return;
  var cards = Array.prototype.slice.call(grid.querySelectorAll('.portfolio-card'));
  var filters = Array.prototype.slice.call(document.querySelectorAll('[data-filter]'));
  var count = document.querySelector('[data-project-count]');
  var status = document.querySelector('[data-filter-status]');
  if (!cards.length || !filters.length) return;

  function applyFilter(value) {
    var visible = 0;
    cards.forEach(function (card) {
      var show = value === 'all' || card.getAttribute('data-category') === value;
      card.hidden = !show;
      if (show) visible += 1;
    });
    filters.forEach(function (button) {
      button.setAttribute('aria-pressed', button.getAttribute('data-filter') === value ? 'true' : 'false');
    });
    if (count) count.textContent = String(visible).padStart(2, '0');
    if (status) {
      var label = value === 'all' ? 'selected projects' : value;
      status.textContent = 'Showing ' + visible + ' ' + label + '.';
    }
  }

  filters.forEach(function (button) {
    button.addEventListener('click', function () {
      applyFilter(button.getAttribute('data-filter') || 'all');
    });
  });
  applyFilter('all');
})();
