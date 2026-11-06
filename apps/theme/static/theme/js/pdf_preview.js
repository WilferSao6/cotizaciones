/**
 * pdf_preview.js — Modal de Vista Previa y cierre del PDF
 * Se carga despues de calculator.js (usa buildQuotePDF, withJsPDF y canBuildQuote)
 */

function previewPDF() {
    if (!canBuildQuote()) return;

    withJsPDF(function () {
        preloadLogo(function () {
            var blob = buildQuotePDF().doc.output('blob');
            var bu   = URL.createObjectURL(blob);
            var fr   = document.getElementById('pdfIframe');
            if (fr.dataset.blobUrl) { URL.revokeObjectURL(fr.dataset.blobUrl); }
            fr.dataset.blobUrl = bu;
            fr.src = bu;
            document.getElementById('pdfPreviewModal').classList.add('open');
            document.addEventListener('keydown', _escHandler);
        });
    });
}

/** Cierra el modal de vista previa y libera la URL del blob */
function closePDFModal() {
    var modal = document.getElementById('pdfPreviewModal');
    var fr    = document.getElementById('pdfIframe');
    modal.classList.remove('open');
    if (fr && fr.dataset.blobUrl) {
        URL.revokeObjectURL(fr.dataset.blobUrl);
        fr.dataset.blobUrl = '';
        fr.src = '';
    }
    document.removeEventListener('keydown', _escHandler);
}

function _escHandler(e) {
    if (e.key === 'Escape') { closePDFModal(); }
}

// Cerrar al hacer clic en el fondo del modal
(function () {
    var modal = document.getElementById('pdfPreviewModal');
    if (modal) {
        modal.addEventListener('click', function (e) {
            if (e.target === modal) { closePDFModal(); }
        });
    }
}());
