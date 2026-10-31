'use strict';

/* =================================================================================
   NOUGHT & CROSS — vanilla JS, MVC-flavoured architecture
   -----------------------------------------------------------------------------
   MODEL   -> GameEngine        (pure 3x3 matrix state, win detection, no DOM)
   AI      -> AIEngine          (Minimax + alpha-beta pruning, difficulty tiers)
   MODEL   -> TournamentManager (round tracking, scoring, standings)
   VIEW    -> UI                (all DOM reads/writes live here, nowhere else)
   CONTROL -> App               (screen/state machine, wires input -> model -> view)
   ================================================================================= */

/* ---------------------------------------------------------------------------
   GameEngine — isolated board matrix + rules. No knowledge of the DOM at all,
   so the AI can simulate thousands of virtual games per real move instantly.
--------------------------------------------------------------------------- */
class GameEngine {
  static LINES = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8], // rows
    [0, 3, 6], [1, 4, 7], [2, 5, 8], // columns
    [0, 4, 8], [2, 4, 6]             // diagonals
  ];

  constructor() {
    this.reset();
  }

  reset() {
    this.board = Array(9).fill(null);
    this.current = 'X';
    this.winner = null;   // 'X' | 'O' | 'draw' | null
    this.winLine = null;  // [i,j,k] | null
  }

  clone() {
    const g = new GameEngine();
    g.board = this.board.slice();
    g.current = this.current;
    g.winner = this.winner;
    g.winLine = this.winLine;
    return g;
  }

  availableMoves(board = this.board) {
    const moves = [];
    for (let i = 0; i < 9; i++) if (board[i] === null) moves.push(i);
    return moves;
  }

  isFull(board = this.board) {
    return board.every(cell => cell !== null);
  }

  /** Pure function: evaluate any board, real or hypothetical. */
  static evaluate(board) {
    for (const line of GameEngine.LINES) {
      const [a, b, c] = line;
      if (board[a] && board[a] === board[b] && board[b] === board[c]) {
        return { winner: board[a], line };
      }
    }
    if (board.every(cell => cell !== null)) return { winner: 'draw', line: null };
    return { winner: null, line: null };
  }

  /** Apply a move to THIS engine's live state (mutates, used for the real game). */
  play(index) {
    if (this.winner || this.board[index] !== null) return false;
    this.board[index] = this.current;
    const result = GameEngine.evaluate(this.board);
    this.winner = result.winner;
    this.winLine = result.line;
    if (!this.winner) this.current = this.current === 'X' ? 'O' : 'X';
    return true;
  }
}

/* ---------------------------------------------------------------------------
   AIEngine — Minimax with alpha-beta pruning.
   Depth-first search over the full game tree of a 3x3 board (max 9 plies,
   trivial for a modern CPU) — pruning simply guarantees we never waste
   cycles on branches that cannot change the outcome, keeping move
   selection effectively instantaneous at every difficulty tier.
--------------------------------------------------------------------------- */
class AIEngine {
  constructor(aiSymbol, humanSymbol) {
    this.ai = aiSymbol;
    this.human = humanSymbol;
  }

  /** Score a terminal board from the AI's perspective; prefers faster wins
   *  and slower losses so the AI plays "meanly" rather than merely correctly. */
  score(result, depth) {
    if (result.winner === this.ai) return 10 - depth;
    if (result.winner === this.human) return depth - 10;
    return 0;
  }

  minimax(board, depth, isMaximizing, alpha, beta) {
    const result = GameEngine.evaluate(board);
    if (result.winner) return this.score(result, depth);

    if (isMaximizing) {
      let best = -Infinity;
      for (let i = 0; i < 9; i++) {
        if (board[i] !== null) continue;
        board[i] = this.ai;
        best = Math.max(best, this.minimax(board, depth + 1, false, alpha, beta));
        board[i] = null;
        alpha = Math.max(alpha, best);
        if (beta <= alpha) break; // alpha-beta cut-off
      }
      return best;
    } else {
      let best = Infinity;
      for (let i = 0; i < 9; i++) {
        if (board[i] !== null) continue;
        board[i] = this.human;
        best = Math.min(best, this.minimax(board, depth + 1, true, alpha, beta));
        board[i] = null;
        beta = Math.min(beta, best);
        if (beta <= alpha) break;
      }
      return best;
    }
  }

  /** Returns the single best move index via full-depth alpha-beta search. */
  bestMove(board) {
    let bestScore = -Infinity;
    let move = null;
    for (let i = 0; i < 9; i++) {
      if (board[i] !== null) continue;
      board[i] = this.ai;
      const s = this.minimax(board, 0, false, -Infinity, Infinity);
      board[i] = null;
      if (s > bestScore) {
        bestScore = s;
        move = i;
      }
    }
    return move;
  }

  randomMove(board) {
    const moves = board.reduce((acc, v, i) => (v === null ? (acc.push(i), acc) : acc), []);
    return moves[Math.floor(Math.random() * moves.length)];
  }

  /**
   * Difficulty matrix:
   *  - easy:       70% random play, 30% calculated -> loose and beatable
   *  - medium:     40% random play, 60% calculated -> competent, occasionally slips
   *  - unbeatable: 100% full-depth alpha-beta -> mathematically flawless
   */
  chooseMove(board, difficulty) {
    const roll = Math.random();
    if (difficulty === 'easy') {
      return roll < 0.30 ? this.bestMove(board) : this.randomMove(board);
    }
    if (difficulty === 'medium') {
      return roll < 0.60 ? this.bestMove(board) : this.randomMove(board);
    }
    return this.bestMove(board); // unbeatable / grandmaster
  }
}

/* ---------------------------------------------------------------------------
   TournamentManager — stateful multi-round scoring engine.
--------------------------------------------------------------------------- */
class TournamentManager {
  constructor(nameX, nameO, totalRounds, opponentType = 'human', aiDifficulty = null) {
    this.nameX = nameX;
    this.nameO = nameO;
    this.totalRounds = totalRounds;
    this.currentRound = 1;
    this.scores = { X: 0, O: 0 };
    this.startingSymbol = 'X'; // alternates each round for fairness
    this.opponentType = opponentType; // 'human' | 'ai'
    this.aiDifficulty = aiDifficulty; // 'easy' | 'medium' | 'unbeatable' | null
    this.isAI = opponentType === 'ai';
  }

  recordResult(winner) {
    if (winner === 'draw') {
      this.scores.X += 1;
      this.scores.O += 1;
    } else if (winner === 'X') {
      this.scores.X += 3;
    } else if (winner === 'O') {
      this.scores.O += 3;
    }
  }

  advanceRound() {
    this.currentRound += 1;
    this.startingSymbol = this.startingSymbol === 'X' ? 'O' : 'X';
  }

  isFinished() {
    return this.currentRound > this.totalRounds;
  }

  progressPct() {
    return Math.min(100, ((this.currentRound - 1) / this.totalRounds) * 100);
  }

  leader() {
    if (this.scores.X === this.scores.O) return 'tie';
    return this.scores.X > this.scores.O ? 'X' : 'O';
  }

  champion() {
    if (this.scores.X === this.scores.O) return 'tie';
    return this.scores.X > this.scores.O ? this.nameX : this.nameO;
  }
}

/* ---------------------------------------------------------------------------
   UI — the sole owner of every DOM read/write. Batches per-frame updates and
   targets specific nodes rather than re-rendering wholesale.
--------------------------------------------------------------------------- */
class UI {
  constructor() {
    this.$ = (sel) => document.querySelector(sel);
    this.$$ = (sel) => Array.from(document.querySelectorAll(sel));

    this.screens = this.$$('.screen');
    this.cells = this.$$('.cell');
    this.boardEl = this.$('#board');
    this.winLineSvg = this.$('#win-line');
    this.winLineEl = this.$('#win-line-el');

    this.modalOverlay = this.$('#modal-overlay');
    this.modalIcon = this.$('#modal-icon');
    this.modalTitle = this.$('#modal-title');
    this.modalSubtitle = this.$('#modal-subtitle');
    this.modalLeaderboard = this.$('#modal-leaderboard');
    this.modalActions = this.$('#modal-actions');
  }

  showScreen(name) {
    this.screens.forEach(s => s.classList.toggle('active', s.dataset.screen === name));
  }

  /* ---------- Board rendering ---------- */
  renderBoard(board) {
    board.forEach((val, i) => {
      const cell = this.cells[i];
      cell.classList.remove('filled', 'x', 'o', 'win-cell');
      cell.innerHTML = '';
      if (val === 'X') {
        cell.classList.add('filled', 'x');
        cell.innerHTML = '<i class="fa-solid fa-xmark"></i>';
      } else if (val === 'O') {
        cell.classList.add('filled', 'o');
        cell.innerHTML = '<i class="fa-regular fa-circle"></i>';
      }
    });
  }

  setCellsLocked(locked) {
    this.cells.forEach(c => c.classList.toggle('locked', locked));
  }

  highlightWin(line) {
    if (!line) {
      this.winLineSvg.classList.remove('show');
      return;
    }
    line.forEach(i => this.cells[i].classList.add('win-cell'));

    const centers = [50, 150, 250];
    const posOf = (i) => ({ x: centers[i % 3], y: centers[Math.floor(i / 3)] });
    const [a, , c] = line;
    const p1 = posOf(a), p2 = posOf(c);

    // extend the line slightly past the outer cells for a confident, edge-to-edge stroke
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    const ext = 28;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;

    this.winLineEl.setAttribute('x1', p1.x - ux * ext);
    this.winLineEl.setAttribute('y1', p1.y - uy * ext);
    this.winLineEl.setAttribute('x2', p2.x + ux * ext);
    this.winLineEl.setAttribute('y2', p2.y + uy * ext);
    // force reflow so the dash-offset transition replays every time
    void this.winLineSvg.offsetWidth;
    this.winLineSvg.classList.add('show');
  }

  clearWinLine() {
    this.winLineSvg.classList.remove('show');
    this.cells.forEach(c => c.classList.remove('win-cell'));
  }

  /* ---------- Player cards / status ---------- */
  setPlayerNames(nameX, nameO) {
    this.$('#name-x').textContent = nameX;
    this.$('#name-o').textContent = nameO;
  }

  setScores(x, o, suffix = 'pts') {
    this.$('#score-x').textContent = `${x} ${suffix}`;
    this.$('#score-o').textContent = `${o} ${suffix}`;
  }

  setActivePlayer(symbol) {
    this.$('#card-x').classList.toggle('active', symbol === 'X');
    this.$('#card-o').classList.toggle('active', symbol === 'O');
  }

  setStatus(text) {
    this.$('#status-text').textContent = text;
  }

  /* ---------- Tournament strip ---------- */
  showTourneyStrip(show) {
    this.$('#tourney-strip').hidden = !show;
  }

  updateTourneyStrip(round, total, leaderLabel, pct) {
    this.$('#tourney-round-label').textContent = `Round ${round} of ${total}`;
    this.$('#tourney-leader-label').textContent = leaderLabel;
    this.$('#tourney-progress').style.width = `${pct}%`;
  }

  /* ---------- Difficulty / rounds pill selection ---------- */
  selectDiffCard(diff) {
    this.$$('.diff-card').forEach(c => c.classList.toggle('selected', c.dataset.diff === diff));
  }

  selectStarter(starter) {
    this.$$('[data-starter]').forEach(b => b.classList.toggle('active', b.dataset.starter === starter));
  }

  selectRounds(rounds) {
    this.$$('[data-rounds]').forEach(b => b.classList.toggle('active', b.dataset.rounds === String(rounds)));
  }

  /* ---------- Modal ---------- */
  openModal({ icon, title, subtitle, leaderboardRows, actions }) {
    this.modalIcon.innerHTML = `<i class="fa-solid ${icon}"></i>`;
    this.modalTitle.textContent = title;
    this.modalSubtitle.textContent = subtitle;

    if (leaderboardRows && leaderboardRows.length) {
      this.modalLeaderboard.hidden = false;
      this.modalLeaderboard.innerHTML = leaderboardRows.map(r => `
        <div class="lb-row ${r.champion ? 'champion' : ''}">
          <span class="lb-name">${r.icon}${r.name}</span>
          <span class="lb-score">${r.score} pts</span>
        </div>`).join('');
    } else {
      this.modalLeaderboard.hidden = true;
      this.modalLeaderboard.innerHTML = '';
    }

    this.modalActions.innerHTML = '';
    actions.forEach(({ label, primary, onClick }) => {
      const btn = document.createElement('button');
      btn.className = primary ? 'btn-primary' : 'btn-ghost';
      btn.innerHTML = `<span>${label}</span>`;
      btn.addEventListener('click', onClick);
      this.modalActions.appendChild(btn);
    });

    this.modalOverlay.classList.add('show');
  }

  closeModal() {
    this.modalOverlay.classList.remove('show');
  }
}

/* ---------------------------------------------------------------------------
   App — the controller / state machine tying model, AI and view together.
--------------------------------------------------------------------------- */
class App {
  constructor() {
    this.ui = new UI();
    this.engine = new GameEngine();

    // AI-mode config
    this.aiDifficulty = null;
    this.aiSymbol = 'O';
    this.humanSymbol = 'X';
    this.playerStartsAI = true;

    // Mode: 'local' | 'ai' | 'tournament'
    this.mode = 'local';
    this.tournament = null;

    // Session win tallies for non-tournament modes (reset whenever a fresh
    // match is started from the home screen, persist across rematches).
    this.localScores = { X: 0, O: 0 };
    this.aiScores = { human: 0, ai: 0 };

    this.locked = false; // guards input during AI "thinking" / animations

    this.bindHomeScreen();
    this.bindAISetupScreen();
    this.bindTournamentSetupScreen();
    this.bindGameScreen();
    this.bindGlobal();
  }

  /* ============================= HOME ============================= */
  bindHomeScreen() {
    document.querySelectorAll('.mode-card').forEach(card => {
      card.addEventListener('click', () => {
        const mode = card.dataset.mode;
        if (mode === 'local') {
          this.mode = 'local';
          this.localScores = { X: 0, O: 0 };
          this.ui.setPlayerNames('Player One', 'Player Two');
          this.startLocalMatch();
        } else if (mode === 'ai') {
          this.ui.showScreen('ai-setup');
        } else if (mode === 'tournament') {
          this.ui.showScreen('tourney-setup');
        }
      });
    });
  }

  /* ============================= AI SETUP ============================= */
  bindAISetupScreen() {
    document.querySelectorAll('.diff-card').forEach(card => {
      card.addEventListener('click', () => {
        this.aiDifficulty = card.dataset.diff;
        this.ui.selectDiffCard(this.aiDifficulty);
        this.$startAIBtn.disabled = false;
      });
    });

    document.querySelectorAll('[data-starter]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.playerStartsAI = btn.dataset.starter === 'player';
        this.ui.selectStarter(btn.dataset.starter);
      });
    });

    this.$startAIBtn = document.getElementById('btn-start-ai');
    this.$startAIBtn.addEventListener('click', () => {
      this.mode = 'ai';
      this.aiScores = { human: 0, ai: 0 };
      this.humanSymbol = this.playerStartsAI ? 'X' : 'O';
      this.aiSymbol = this.playerStartsAI ? 'O' : 'X';
      this.ui.setPlayerNames(
        this.humanSymbol === 'X' ? 'You' : 'Grandmaster AI',
        this.humanSymbol === 'X' ? 'Grandmaster AI' : 'You'
      );
      this.startAIMatch();
    });

    document.querySelectorAll('[data-back]').forEach(btn => {
      btn.addEventListener('click', () => this.ui.showScreen(btn.dataset.back));
    });
  }

  /* ============================= TOURNAMENT SETUP ============================= */
  bindTournamentSetupScreen() {
    let rounds = 5;
    let opponentType = 'human';
    let tDifficulty = null;

    const diffLabel = { easy: 'Easy AI', medium: 'Medium AI', unbeatable: 'Grandmaster AI' };
    const $p2Field = document.getElementById('field-p2');
    const $p2Input = document.getElementById('input-p2');
    const $tDiffGrid = document.getElementById('tourney-diff-grid');
    const $startBtn = document.getElementById('btn-start-tourney');

    const refreshStartState = () => {
      $startBtn.disabled = opponentType === 'ai' && !tDifficulty;
    };

    document.querySelectorAll('[data-rounds]').forEach(btn => {
      btn.addEventListener('click', () => {
        rounds = parseInt(btn.dataset.rounds, 10);
        this.ui.selectRounds(rounds);
      });
    });

    document.querySelectorAll('#tourney-opponent-row [data-opponent]').forEach(btn => {
      btn.addEventListener('click', () => {
        opponentType = btn.dataset.opponent;
        document.querySelectorAll('#tourney-opponent-row [data-opponent]').forEach(b =>
          b.classList.toggle('active', b.dataset.opponent === opponentType)
        );
        const isAI = opponentType === 'ai';
        $tDiffGrid.hidden = !isAI;
        $p2Field.hidden = isAI;
        if (isAI) {
          $p2Input.value = tDifficulty ? diffLabel[tDifficulty] : 'AI opponent';
        } else {
          $p2Input.value = 'Player Two';
        }
        refreshStartState();
      });
    });

    document.querySelectorAll('#tourney-diff-grid [data-tdiff]').forEach(card => {
      card.addEventListener('click', () => {
        tDifficulty = card.dataset.tdiff;
        document.querySelectorAll('#tourney-diff-grid [data-tdiff]').forEach(c =>
          c.classList.toggle('selected', c.dataset.tdiff === tDifficulty)
        );
        $p2Input.value = diffLabel[tDifficulty];
        refreshStartState();
      });
    });

    document.getElementById('btn-start-tourney').addEventListener('click', () => {
      const p1 = document.getElementById('input-p1').value.trim() || 'Player One';
      const p2 = opponentType === 'ai'
        ? diffLabel[tDifficulty]
        : ($p2Input.value.trim() || 'Player Two');

      this.mode = 'tournament';
      this.tournament = new TournamentManager(p1, p2, rounds, opponentType, tDifficulty);

      if (this.tournament.isAI) {
        this.humanSymbol = 'X';
        this.aiSymbol = 'O';
        this.aiDifficulty = tDifficulty;
      }

      this.ui.setPlayerNames(p1, p2);
      this.ui.showTourneyStrip(true);
      this.startTournamentRound();
    });
  }

  /* ============================= GAME SCREEN ============================= */
  bindGameScreen() {
    this.ui.cells.forEach((cell, i) => {
      cell.addEventListener('click', () => this.handleCellClick(i));
    });

    document.getElementById('btn-restart').addEventListener('click', () => {
      if (this.mode === 'tournament') {
        this.startTournamentRound(true);
      } else if (this.mode === 'ai') {
        this.startAIMatch();
      } else {
        this.startLocalMatch();
      }
    });

    document.getElementById('btn-quit').addEventListener('click', () => this.goHome());
  }

  bindGlobal() {
    document.getElementById('btn-home').addEventListener('click', () => this.goHome());
  }

  goHome() {
    this.ui.closeModal();
    this.ui.showTourneyStrip(false);
    this.tournament = null;
    this.ui.setScores(0, 0);
    this.ui.showScreen('home');
  }

  /* ============================= MATCH LIFECYCLE ============================= */
  startLocalMatch() {
    this.engine.reset();
    this.ui.showTourneyStrip(false);
    this.ui.setScores(this.localScores.X, this.localScores.O, 'wins');
    this.ui.showScreen('game');
    this.renderFreshBoard();
  }

  startAIMatch() {
    this.engine.reset();
    this.ui.showTourneyStrip(false);
    const xScore = this.humanSymbol === 'X' ? this.aiScores.human : this.aiScores.ai;
    const oScore = this.humanSymbol === 'X' ? this.aiScores.ai : this.aiScores.human;
    this.ui.setScores(xScore, oScore, 'wins');
    this.ui.showScreen('game');
    this.renderFreshBoard();

    if (this.engine.current === this.aiSymbol) {
      this.queueAIMove();
    }
  }

  startTournamentRound(isRestartOnly = false) {
    this.engine.reset();
    this.engine.current = this.tournament.startingSymbol;
    this.ui.showScreen('game');
    this.ui.showTourneyStrip(true);
    this.ui.setScores(this.tournament.scores.X, this.tournament.scores.O);

    const leaderLabel = this.tournament.scores.X === 0 && this.tournament.scores.O === 0
      ? 'No matches yet'
      : this.tournament.leader() === 'tie'
        ? 'Currently tied'
        : `${this.tournament.leader() === 'X' ? this.tournament.nameX : this.tournament.nameO} leads`;

    this.ui.updateTourneyStrip(
      Math.min(this.tournament.currentRound, this.tournament.totalRounds),
      this.tournament.totalRounds,
      leaderLabel,
      this.tournament.progressPct()
    );

    this.renderFreshBoard();

    if (this.isAIOpponentMode() && this.engine.current === this.aiSymbol) {
      this.queueAIMove();
    }
  }

  renderFreshBoard() {
    this.locked = false;
    this.ui.renderBoard(this.engine.board);
    this.ui.clearWinLine();
    this.ui.setCellsLocked(false);
    this.ui.setActivePlayer(this.engine.current);
    this.updateStatusText();
  }

  isAIOpponentMode() {
    return this.mode === 'ai' || (this.mode === 'tournament' && this.tournament && this.tournament.isAI);
  }

  updateStatusText() {
    if (this.isAIOpponentMode()) {
      const isHumanTurn = this.engine.current === this.humanSymbol;
      this.ui.setStatus(isHumanTurn ? 'Your turn' : 'AI is thinking…');
    } else {
      const label = this.engine.current === 'X'
        ? document.getElementById('name-x').textContent
        : document.getElementById('name-o').textContent;
      this.ui.setStatus(`${label}'s turn`);
    }
  }

  /* ============================= INPUT HANDLING ============================= */
  handleCellClick(index) {
    if (this.locked || this.engine.winner) return;
    if (this.isAIOpponentMode() && this.engine.current !== this.humanSymbol) return;

    const played = this.engine.play(index);
    if (!played) return;

    this.ui.renderBoard(this.engine.board);

    if (this.engine.winner) {
      this.onMatchEnd();
      return;
    }

    this.ui.setActivePlayer(this.engine.current);
    this.updateStatusText();

    if (this.isAIOpponentMode() && this.engine.current === this.aiSymbol) {
      this.queueAIMove();
    }
  }

  queueAIMove() {
    this.locked = true;
    this.ui.setCellsLocked(true);
    this.updateStatusText();

    // A brief, deliberate delay reads as "thinking" without ever feeling laggy.
    setTimeout(() => {
      const ai = new AIEngine(this.aiSymbol, this.humanSymbol);
      const move = ai.chooseMove(this.engine.board.slice(), this.aiDifficulty);
      this.engine.play(move);
      this.ui.renderBoard(this.engine.board);
      this.locked = false;
      this.ui.setCellsLocked(false);

      if (this.engine.winner) {
        this.onMatchEnd();
      } else {
        this.ui.setActivePlayer(this.engine.current);
        this.updateStatusText();
      }
    }, 450 + Math.random() * 350);
  }

  /* ============================= END OF MATCH ============================= */
  onMatchEnd() {
    this.locked = true;
    this.ui.setCellsLocked(true);
    this.ui.highlightWin(this.engine.winLine);

    if (this.mode === 'tournament') {
      this.tournament.recordResult(this.engine.winner);
      this.ui.setScores(this.tournament.scores.X, this.tournament.scores.O);
      setTimeout(() => this.showTournamentRoundModal(), 550);
    } else if (this.mode === 'ai') {
      if (this.engine.winner !== 'draw') {
        if (this.engine.winner === this.humanSymbol) this.aiScores.human += 1;
        else this.aiScores.ai += 1;
      }
      const xScore = this.humanSymbol === 'X' ? this.aiScores.human : this.aiScores.ai;
      const oScore = this.humanSymbol === 'X' ? this.aiScores.ai : this.aiScores.human;
      this.ui.setScores(xScore, oScore, 'wins');
      setTimeout(() => this.showAIResultModal(), 550);
    } else {
      if (this.engine.winner !== 'draw') this.localScores[this.engine.winner] += 1;
      this.ui.setScores(this.localScores.X, this.localScores.O, 'wins');
      setTimeout(() => this.showLocalResultModal(), 550);
    }
  }

  showLocalResultModal() {
    const isDraw = this.engine.winner === 'draw';
    const winnerName = this.engine.winner === 'X'
      ? document.getElementById('name-x').textContent
      : document.getElementById('name-o').textContent;

    this.ui.openModal({
      icon: isDraw ? 'fa-handshake' : 'fa-trophy',
      title: isDraw ? "It's a draw" : `${winnerName} wins`,
      subtitle: isDraw ? 'Neither side could break through.' : 'A clean line across the board.',
      leaderboardRows: null,
      actions: [
        { label: 'Play again', primary: true, onClick: () => { this.ui.closeModal(); this.startLocalMatch(); } },
        { label: 'Menu', primary: false, onClick: () => this.goHome() }
      ]
    });
  }

  showAIResultModal() {
    const isDraw = this.engine.winner === 'draw';
    const humanWon = this.engine.winner === this.humanSymbol;

    let icon, title, subtitle;
    if (isDraw) {
      icon = 'fa-handshake';
      title = 'A perfect stalemate';
      subtitle = this.aiDifficulty === 'unbeatable'
        ? 'Against the Grandmaster, a draw is the best any player can force.'
        : 'Neither side found an opening.';
    } else if (humanWon) {
      icon = 'fa-trophy';
      title = 'You win';
      subtitle = 'The AI missed its line — well played.';
    } else {
      icon = 'fa-microchip';
      title = 'AI wins';
      subtitle = 'The board favoured the machine this time.';
    }

    this.ui.openModal({
      icon, title, subtitle,
      leaderboardRows: null,
      actions: [
        { label: 'Rematch', primary: true, onClick: () => { this.ui.closeModal(); this.startAIMatch(); } },
        { label: 'Menu', primary: false, onClick: () => this.goHome() }
      ]
    });
  }

  showTournamentRoundModal() {
    const t = this.tournament;
    const isDraw = this.engine.winner === 'draw';
    const winnerName = isDraw ? null : (this.engine.winner === 'X' ? t.nameX : t.nameO);

    const rows = [
      { name: t.nameX, icon: '<i class="fa-solid fa-xmark" style="color:var(--ice); margin-right:6px;"></i>', score: t.scores.X, champion: false },
      { name: t.nameO, icon: '<i class="fa-regular fa-circle" style="color:var(--champagne); margin-right:6px;"></i>', score: t.scores.O, champion: false }
    ];

    const roundJustPlayed = t.currentRound;
    t.advanceRound();

    if (t.isFinished()) {
      const champ = t.champion();
      rows.forEach(r => { if (r.name === champ) r.champion = true; });
      this.ui.openModal({
        icon: 'fa-crown',
        title: champ === 'tie' ? 'Tournament tied' : `${champ} is champion`,
        subtitle: `Final standings after ${t.totalRounds} rounds.`,
        leaderboardRows: rows,
        actions: [
          { label: 'New tournament', primary: true, onClick: () => { this.ui.closeModal(); this.goHome(); this.ui.showScreen('tourney-setup'); } },
          { label: 'Menu', primary: false, onClick: () => this.goHome() }
        ]
      });
    } else {
      this.ui.openModal({
        icon: isDraw ? 'fa-handshake' : 'fa-medal',
        title: isDraw ? `Round ${roundJustPlayed}: draw` : `Round ${roundJustPlayed}: ${winnerName} wins`,
        subtitle: `${t.totalRounds - t.currentRound + 1} round${t.totalRounds - t.currentRound + 1 === 1 ? '' : 's'} remaining.`,
        leaderboardRows: rows,
        actions: [
          { label: 'Next round', primary: true, onClick: () => { this.ui.closeModal(); this.startTournamentRound(); } },
          { label: 'Menu', primary: false, onClick: () => this.goHome() }
        ]
      });
    }
  }
}

/* ============================= BOOT ============================= */
document.addEventListener('DOMContentLoaded', () => {
  window.__app = new App();
});
