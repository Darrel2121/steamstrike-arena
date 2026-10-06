/**
 * Battle Map Editor Toolbar Controller
 * Manages tool selection, map properties, storage actions, and validation UI
 */

export class EditorToolbar {
  /**
   * @param {import('./MapEditor.js').MapEditor} editor - Reference to the MapEditor instance
   */
  constructor(editor) {
    this.editor = editor;
    this.activeTool = 'wall';

    this.bindDomElements();
    this.attachEventListeners();
  }

  bindDomElements() {
    this.toolButtons = document.querySelectorAll('.tool-btn');
    this.mapNameInput = document.getElementById('mapNameInput');
    this.editorTemplateSelect = document.getElementById('editorTemplateSelect');
    this.gridSizeSelect = document.getElementById('gridSizeSelect');

    this.btnBorderWall = document.getElementById('btnBorderWall');
    this.btnClearGrid = document.getElementById('btnClearGrid');
    this.btnDefaultMap = document.getElementById('btnDefaultMap');

    this.btnSaveLocal = document.getElementById('btnSaveLocal');
    this.btnLoadLocal = document.getElementById('btnLoadLocal');
    this.btnExportJson = document.getElementById('btnExportJson');
    this.btnImportJson = document.getElementById('btnImportJson');
    this.btnProposeMapOnline = document.getElementById('btnProposeMapOnline');
    this.fileInputMap = document.getElementById('fileInputMap');
    this.btnLaunchCustomMatch = document.getElementById('btnLaunchCustomMatch');
    this.btnEditorReturnHome = document.getElementById('btnEditorReturnHome');
    this.btnEditorPlaySolo = document.getElementById('btnEditorPlaySolo');
    this.btnEditorPlayOnline = document.getElementById('btnEditorPlayOnline');

    this.btnZoomIn = document.getElementById('btnZoomIn');
    this.btnZoomOut = document.getElementById('btnZoomOut');
    this.btnZoomReset = document.getElementById('btnZoomReset');

    this.validationBadge = document.getElementById('validationBadge');
    this.validationErrorsList = document.getElementById('validationErrorsList');

    this.statWalls = document.getElementById('statWalls');
    this.statObstacles = document.getElementById('statObstacles');
    this.statPlayerSpawns = document.getElementById('statPlayerSpawns');
    this.statBotSpawns = document.getElementById('statBotSpawns');
    this.statDecorations = document.getElementById('statDecorations');
    this.statSegments = document.getElementById('statSegments');

    this.statusBarCoords = document.getElementById('statusBarCoords');
    this.statusBarDimensions = document.getElementById('statusBarDimensions');
    this.statusBarZoom = document.getElementById('statusBarZoom');
  }

  attachEventListeners() {
    // Tool buttons selection
    this.toolButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const tool = btn.dataset.tool;
        this.selectTool(tool);
      });
    });

    // Map Name input
    if (this.mapNameInput) {
      this.mapNameInput.addEventListener('input', (e) => {
        this.editor.setMapName(e.target.value);
      });
    }

    // Grid size select
    if (this.gridSizeSelect) {
      this.gridSizeSelect.addEventListener('change', (e) => {
        const size = parseInt(e.target.value, 10);
        this.editor.resizeGrid(size, size);
      });
    }

    // Border Wall
    if (this.btnBorderWall) {
      this.btnBorderWall.addEventListener('click', () => this.editor.addBorderWalls());
    }

    // Clear Grid
    if (this.btnClearGrid) {
      this.btnClearGrid.addEventListener('click', () => {
        if (confirm('Clear entire grid to open floor?')) {
          this.editor.clearGrid();
        }
      });
    }

    // Preset Template Select
    if (this.editorTemplateSelect) {
      this.editorTemplateSelect.addEventListener('change', (e) => {
        const val = e.target.value;
        if (val) {
          this.editor.loadPresetMap(val);
          setTimeout(() => {
            if (this.editorTemplateSelect) this.editorTemplateSelect.value = '';
          }, 300);
        }
      });
    }

    // Default Map
    if (this.btnDefaultMap) {
      this.btnDefaultMap.addEventListener('click', () => {
        if (confirm('Reset to canonical Clockwork Foundry arena?')) {
          this.editor.loadDefaultMap();
        }
      });
    }

    // Save to LocalStorage
    if (this.btnSaveLocal) {
      this.btnSaveLocal.addEventListener('click', () => this.editor.saveToLocalStorage());
    }

    // Load from LocalStorage
    if (this.btnLoadLocal) {
      this.btnLoadLocal.addEventListener('click', () => this.editor.loadFromLocalStorage());
    }

    // Export JSON File Download
    if (this.btnExportJson) {
      this.btnExportJson.addEventListener('click', () => this.editor.exportJsonFile());
    }

    // Propose Map for Official Game Publication
    if (this.btnProposeMapOnline) {
      this.btnProposeMapOnline.addEventListener('click', () => this.editor.openSubmitMapModal());
    }

    // Import JSON File Trigger
    if (this.btnImportJson && this.fileInputMap) {
      this.btnImportJson.addEventListener('click', () => this.fileInputMap.click());
      this.fileInputMap.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
          const reader = new FileReader();
          reader.onload = (event) => {
            this.editor.importJsonString(event.target.result);
            e.target.value = ''; // Reset input
          };
          reader.readAsText(file);
        }
      });
    }

    // Launch Match on Custom Map (Legacy & Direct)
    if (this.btnLaunchCustomMatch) {
      this.btnLaunchCustomMatch.addEventListener('click', () => {
        this.editor.launchMatch('solo');
      });
    }

    if (this.btnEditorPlaySolo) {
      this.btnEditorPlaySolo.addEventListener('click', () => {
        this.editor.launchMatch('solo');
      });
    }

    if (this.btnEditorPlayOnline) {
      this.btnEditorPlayOnline.addEventListener('click', () => {
        this.editor.launchMatch('online');
      });
    }

    if (this.btnEditorReturnHome) {
      this.btnEditorReturnHome.addEventListener('click', () => {
        this.editor.returnHome();
      });
    }

    // Zoom Controls
    if (this.btnZoomIn) {
      this.btnZoomIn.addEventListener('click', () => this.editor.adjustZoom(0.2));
    }
    if (this.btnZoomOut) {
      this.btnZoomOut.addEventListener('click', () => this.editor.adjustZoom(-0.2));
    }
    if (this.btnZoomReset) {
      this.btnZoomReset.addEventListener('click', () => this.editor.resetView());
    }
  }

  selectTool(toolName) {
    this.activeTool = toolName;
    this.toolButtons.forEach(btn => {
      if (btn.dataset.tool === toolName) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
    this.editor.setActiveTool(toolName);
  }

  updateValidationUI(validation, stats) {
    if (!this.validationBadge) return;

    if (validation.valid) {
      this.validationBadge.className = 'badge-status valid';
      this.validationBadge.innerHTML = '&check; PLAYABLE';
      if (this.validationErrorsList) {
        this.validationErrorsList.style.display = 'none';
        this.validationErrorsList.innerHTML = '';
      }
    } else {
      this.validationBadge.className = 'badge-status invalid';
      this.validationBadge.innerHTML = '&#10008; INVALID (' + validation.errors.length + ')';
      if (this.validationErrorsList) {
        this.validationErrorsList.style.display = 'flex';
        this.validationErrorsList.innerHTML = validation.errors
          .map(err => `<li>${this.escapeHtml(err)}</li>`)
          .join('');
      }
    }

    if (this.statWalls) this.statWalls.textContent = stats.walls;
    if (this.statObstacles) this.statObstacles.textContent = stats.obstacles;
    if (this.statPlayerSpawns) this.statPlayerSpawns.textContent = stats.playerSpawns;
    if (this.statBotSpawns) this.statBotSpawns.textContent = stats.botSpawns;
    if (this.statDecorations) this.statDecorations.textContent = stats.decorations || 0;
    if (this.statSegments) this.statSegments.textContent = stats.segments;

    if (this.statusBarDimensions) {
      const w = this.editor.map.width;
      const h = this.editor.map.height;
      const ts = this.editor.map.tileSize;
      this.statusBarDimensions.textContent = `Dimensions: ${w} x ${h} (${w * ts} x ${h * ts} px)`;
    }
    if (this.mapNameInput && this.mapNameInput.value !== this.editor.map.name) {
      this.mapNameInput.value = this.editor.map.name;
    }
    if (this.gridSizeSelect) {
      this.gridSizeSelect.value = this.editor.map.width;
    }
  }

  updateCursor(col, row, worldX, worldY) {
    if (this.statusBarCoords) {
      if (col >= 0 && col < this.editor.map.width && row >= 0 && row < this.editor.map.height) {
        this.statusBarCoords.textContent = `Cursor: (${Math.round(worldX)}, ${Math.round(worldY)}) | Tile: [${col}, ${row}]`;
      } else {
        this.statusBarCoords.textContent = `Cursor: (${Math.round(worldX)}, ${Math.round(worldY)}) | Outside Arena`;
      }
    }
  }

  updateZoom(zoomLevel) {
    if (this.statusBarZoom) {
      this.statusBarZoom.textContent = `Zoom: ${Math.round(zoomLevel * 100)}%`;
    }
  }

  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
}
