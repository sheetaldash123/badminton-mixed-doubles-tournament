import React, {
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";

import { supabase } from "./supabaseClient";

const STORAGE_KEY = "badminton-mixed-doubles-cup-v1";

const ADMIN_EMAIL = import.meta.env.VITE_ADMIN_EMAIL || "";

const emptyPlayers = Array.from({ length: 5 }, (_, i) => ({
  id: i + 1,
  name: ""
}));

const initialState = {
  stage: "setup",
  boys: emptyPlayers,
  girls: emptyPlayers.map((p) => ({ ...p })),
  teams: [],
  format: "single",
  matches: [],
  playoffs: {
    q1: null,
    eliminator: null,
    q2: null,
    final: null
  }
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function shuffle(array) {
  const a = [...array];

  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }

  return a;
}

function makeTeams(boys, girls) {
  const shuffledBoys = shuffle(boys);
  const shuffledGirls = shuffle(girls);

  return shuffledBoys.map((boy, i) => ({
    id: `T${i + 1}`,
    name: `Team ${i + 1}`,
    boy: boy.name.trim(),
    girl: shuffledGirls[i].name.trim()
  }));
}

function makeRoundRobinFixtures(teams) {
  const slots = [...teams.map((t) => t.id), null];
  const rounds = [];

  for (let round = 0; round < 5; round += 1) {
    const matches = [];

    for (let i = 0; i < slots.length / 2; i += 1) {
      const a = slots[i];
      const b = slots[slots.length - 1 - i];

      if (a !== null && b !== null) {
        matches.push({
          id: `L${round + 1}-${matches.length + 1}`,
          round: round + 1,
          teamA: a,
          teamB: b,
          status: "pending",
          result: null
        });
      }
    }

    rounds.push(matches);

    const fixed = slots[0];
    const rotating = slots.slice(1);

    rotating.unshift(rotating.pop());

    slots.splice(
      0,
      slots.length,
      fixed,
      ...rotating
    );
  }

  return rounds.flat();
}

function teamById(teams, id) {
  return teams.find((t) => t.id === id);
}

function teamLabel(teams, id) {
  const team = teamById(teams, id);
  return team ? team.name : "TBD";
}

function getWinner(result) {
  if (!result) return null;

  if (result.games) {
    const a = result.games.filter(
      (g) => g.a > g.b
    ).length;

    const b = result.games.filter(
      (g) => g.b > g.a
    ).length;

    if (a === b) return null;

    return a > b ? result.teamA : result.teamB;
  }

  if (result.scoreA === result.scoreB) {
    return null;
  }

  return result.scoreA > result.scoreB
    ? result.teamA
    : result.teamB;
}

function getScoreLabel(result) {
  if (!result) return "";

  if (result.games) {
    return result.games
      .filter(
        (g) => g.a !== 0 || g.b !== 0
      )
      .map((g) => `${g.a}-${g.b}`)
      .join(", ");
  }

  return `${result.scoreA}-${result.scoreB}`;
}

function getMatchMargin(result) {
  if (!result) return 0;

  if (result.games) {
    return result.games.reduce(
      (sum, g) => sum + Math.abs(g.a - g.b),
      0
    );
  }

  return Math.abs(
    result.scoreA - result.scoreB
  );
}

function getStandings(teams, matches) {
  const table = teams.map((team) => ({
    teamId: team.id,
    played: 0,
    wins: 0,
    losses: 0,
    pf: 0,
    pa: 0,
    margin: 0
  }));

  const map = Object.fromEntries(
    table.map((row) => [row.teamId, row])
  );

  matches
    .filter(
      (m) =>
        m.status === "completed" &&
        m.result
    )
    .forEach((m) => {
      const r = m.result;

      const a = map[r.teamA];
      const b = map[r.teamB];

      if (!a || !b) return;

      a.played += 1;
      b.played += 1;

      if (r.games) {
        r.games.forEach((g) => {
          a.pf += g.a;
          a.pa += g.b;

          b.pf += g.b;
          b.pa += g.a;
        });
      } else {
        a.pf += r.scoreA;
        a.pa += r.scoreB;

        b.pf += r.scoreB;
        b.pa += r.scoreA;
      }

      const winner = getWinner(r);

      if (winner === a.teamId) {
        a.wins += 1;
        b.losses += 1;
      } else if (winner === b.teamId) {
        b.wins += 1;
        a.losses += 1;
      }
    });

  table.forEach((r) => {
    r.margin = r.pf - r.pa;
  });

  return table
    .sort(
      (a, b) =>
        b.wins - a.wins ||
        b.margin - a.margin ||
        b.pf - a.pf ||
        a.teamId.localeCompare(b.teamId)
    )
    .map((row, index) => ({
      ...row,
      position: index + 1
    }));
}

function isResultValid(result, format) {
  if (format === "single") {
    return (
      Number.isInteger(result.scoreA) &&
      Number.isInteger(result.scoreB) &&
      result.scoreA >= 0 &&
      result.scoreB >= 0 &&
      result.scoreA !== result.scoreB
    );
  }

  const games = result.games;

  if (!games || games.length !== 3) {
    return false;
  }

  const validGames = games.every(
    (g) =>
      Number.isInteger(g.a) &&
      Number.isInteger(g.b) &&
      g.a >= 0 &&
      g.b >= 0
  );

  if (!validGames) {
    return false;
  }

  const winsA = games.filter(
    (g) => g.a > g.b
  ).length;

  const winsB = games.filter(
    (g) => g.b > g.a
  ).length;

  return (
    (winsA === 2 && winsB <= 1) ||
    (winsB === 2 && winsA <= 1)
  );
}

function createBlankResult(match, format) {
  if (format === "single") {
    return {
      teamA: match.teamA,
      teamB: match.teamB,
      scoreA: 0,
      scoreB: 0
    };
  }

  return {
    teamA: match.teamA,
    teamB: match.teamB,
    games: [
      { a: 0, b: 0 },
      { a: 0, b: 0 },
      { a: 0, b: 0 }
    ]
  };
}

function App() {
  const [state, setState] = useState(() =>
    clone(initialState)
  );

  const [isLoading, setIsLoading] = useState(true);

  const [selectedTeamId, setSelectedTeamId] =
    useState(null);

  const [isEditMode, setIsEditMode] =
    useState(false);

  const [showPasswordModal, setShowPasswordModal] =
    useState(false);

  const [passwordInput, setPasswordInput] =
    useState("");

  const [passwordError, setPasswordError] =
    useState("");

  const hasLoadedFromSupabase =
    useRef(false);

  const saveRequested = useRef(false);

  // AUTH SESSION
  // Restore admin access after page refresh.
  useEffect(() => {
    let mounted = true;

    const restoreAdminSession = async () => {
      try {
        const {
          data: { session },
          error
        } = await supabase.auth.getSession();

        if (error) {
          console.error(
            "Failed to restore admin session:",
            error
          );
          return;
        }

        if (
          mounted &&
          session?.user?.email &&
          ADMIN_EMAIL &&
          session.user.email.toLowerCase() ===
            ADMIN_EMAIL.toLowerCase()
        ) {
          setIsEditMode(true);
        }
      } catch (error) {
        console.error(
          "Unexpected auth session error:",
          error
        );
      }
    };

    restoreAdminSession();

    // Keep React state synchronized with Supabase auth.
    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (!mounted) return;

        if (
          session?.user?.email &&
          ADMIN_EMAIL &&
          session.user.email.toLowerCase() ===
            ADMIN_EMAIL.toLowerCase()
        ) {
          setIsEditMode(true);
        } else {
          setIsEditMode(false);
        }
      }
    );

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  // LOAD TOURNAMENT FROM SUPABASE
  useEffect(() => {
    const loadTournament = async () => {
      try {
        const { data, error } = await supabase
          .from("tournament_state")
          .select("state")
          .eq("id", 1)
          .single();

        if (error) {
          console.error(
            "Failed to load tournament:",
            error
          );
          return;
        }

        if (
          data?.state &&
          Object.keys(data.state).length > 0
        ) {
          setState(data.state);

          console.log(
            "✅ Tournament loaded from Supabase:",
            data.state
          );
        }
      } catch (error) {
        console.error(
          "Unexpected Supabase error:",
          error
        );
      } finally {
        hasLoadedFromSupabase.current = true;
        setIsLoading(false);
      }
    };

    loadTournament();
  }, []);

  // SAVE TOURNAMENT TO SUPABASE
  useEffect(() => {
    if (
      !hasLoadedFromSupabase.current ||
      !isEditMode ||
      !saveRequested.current
    ) {
      return;
    }

    const saveTournament = async () => {
      saveRequested.current = false;

      console.log(
        "💾 Saving tournament to Supabase...",
        state
      );

      const { data, error } = await supabase
        .from("tournament_state")
        .update({
          state,
          updated_at: new Date().toISOString()
        })
        .eq("id", 1)
        .select();

      if (error) {
        console.error(
          "❌ Failed to save tournament:",
          error
        );

        return;
      }

      console.log(
        "✅ Supabase UPDATE response:",
        data
      );

      if (!data || data.length === 0) {
        console.error(
          "⚠️ UPDATE completed but affected 0 rows. " +
            "Check that tournament_state contains a row with id = 1."
        );
      } else {
        console.log(
          "✅ tournament_state row actually updated:",
          data[0]
        );
      }
    };

    saveTournament();
  }, [state, isEditMode]);

  const standings = useMemo(
    () =>
      getStandings(
        state.teams,
        state.matches
      ),
    [state.teams, state.matches]
  );

  const completedLeague =
    state.matches.filter(
      (m) => m.status === "completed"
    ).length;

  const leagueComplete =
    state.matches.length === 10 &&
    completedLeague === 10;

  // CENTRAL STATE UPDATE FUNCTION
  const updateState = (patch) => {
    if (!isEditMode) return;

    setState((prev) => {
      const nextState =
        typeof patch === "function"
          ? patch(prev)
          : {
              ...prev,
              ...patch
            };

      saveRequested.current = true;

      return nextState;
    });
  };

  // Automatically move to playoffs once
  // all 10 league matches are completed.
  useEffect(() => {
    if (
      !leagueComplete ||
      state.stage === "playoffs" ||
      state.stage === "complete"
    ) {
      return;
    }

    if (isEditMode) {
      updateState({
        stage: "playoffs"
      });
    } else {
      setState((prev) => ({
        ...prev,
        stage: "playoffs"
      }));
    }
  }, [
    leagueComplete,
    state.stage,
    isEditMode
  ]);

  // AUTHENTICATION
  const requestEditMode = () => {
    setPasswordInput("");
    setPasswordError("");
    setShowPasswordModal(true);
  };

  const unlockEditMode = async () => {
    setPasswordError("");

    if (!ADMIN_EMAIL) {
      setPasswordError(
        "Admin email is not configured."
      );
      return;
    }

    if (!passwordInput) {
      setPasswordError(
        "Enter the admin password."
      );
      return;
    }

    const { error } =
      await supabase.auth.signInWithPassword({
        email: ADMIN_EMAIL,
        password: passwordInput
      });

    if (error) {
      console.error(
        "Admin login failed:",
        error
      );

      setPasswordError(
        "Incorrect email or password."
      );

      return;
    }

    setIsEditMode(true);
    setShowPasswordModal(false);
    setPasswordInput("");
    setPasswordError("");
  };

  const lockEditMode = async () => {
    await supabase.auth.signOut();

    setIsEditMode(false);
    setPasswordInput("");
    setPasswordError("");
    setShowPasswordModal(false);
  };

  // PLAYER EDITING
  const updatePlayer = (
    group,
    index,
    name
  ) => {
    if (!isEditMode) return;

    updateState((prev) => ({
      ...prev,
      [group]: prev[group].map(
        (p, i) =>
          i === index
            ? { ...p, name }
            : p
      )
    }));
  };

  // START NEW TOURNAMENT
  // The current tournament is archived first.
  // Nothing is deleted from tournament history.
  const restartTournament = async () => {
    if (!isEditMode) return;

    const hasTournamentData =
      state.boys.some(
        (player) => player.name.trim()
      ) ||
      state.girls.some(
        (player) => player.name.trim()
      ) ||
      state.teams.length > 0 ||
      state.matches.length > 0 ||
      state.playoffs.q1 ||
      state.playoffs.eliminator ||
      state.playoffs.q2 ||
      state.playoffs.final;

    if (!hasTournamentData) {
      alert(
        "There is no tournament data to archive."
      );
      return;
    }

    const confirmed = window.confirm(
      "Start a new tournament?\n\n" +
        "The current tournament will be saved to Tournament History first. " +
        "Nothing from the current tournament will be deleted."
    );

    if (!confirmed) return;

    try {
      // Find champion if the tournament is completed.
      let champion = null;

      if (state.playoffs?.final?.result) {
        const winnerId = getWinner(
          state.playoffs.final.result
        );

        const winnerTeam = state.teams.find(
          (team) => team.id === winnerId
        );

        if (winnerTeam) {
          champion = winnerTeam.name;
        }
      }

      // Save complete current tournament into history.
      const { error: archiveError } =
        await supabase
          .from("tournament_history")
          .insert({
            tournament_name:
              "Badminton Mixed Doubles Cup",
            state: clone(state),
            completed_at:
              state.stage === "complete"
                ? new Date().toISOString()
                : null,
            champion
          });

      if (archiveError) {
        console.error(
          "Failed to archive tournament:",
          archiveError
        );

        alert(
          "The current tournament could not be saved to history.\n\n" +
            "The tournament has NOT been reset."
        );

        return;
      }

      // Only reset the active tournament
      // AFTER the archive succeeds.
      const freshState = clone(
        initialState
      );

      const { error: resetError } =
        await supabase
          .from("tournament_state")
          .update({
            state: freshState,
            updated_at:
              new Date().toISOString()
          })
          .eq("id", 1);

      if (resetError) {
        console.error(
          "Failed to reset active tournament:",
          resetError
        );

        alert(
          "The old tournament was safely saved to history, " +
            "but the new tournament could not be started.\n\n" +
            "Nothing was deleted."
        );

        return;
      }

      setState(freshState);

      localStorage.removeItem(
        STORAGE_KEY
      );

      saveRequested.current = false;
      setSelectedTeamId(null);

      console.log(
        "Tournament archived and new tournament started successfully."
      );
    } catch (error) {
      console.error(
        "Unexpected error while starting new tournament:",
        error
      );

      alert(
        "Something went wrong while starting the new tournament.\n\n" +
          "The current tournament was not intentionally deleted."
      );
    }
  };

  const allPlayersValid =
    state.boys.every(
      (p) => p.name.trim()
    ) &&
    state.girls.every(
      (p) => p.name.trim()
    ) &&
    new Set(
      [...state.boys, ...state.girls].map(
        (p) =>
          p.name.trim().toLowerCase()
      )
    ).size === 10;

  // TEAM PAIRING
  const pairTeams = () => {
    if (!isEditMode) return;

    if (!allPlayersValid) {
      alert(
        "Enter 10 unique player names first."
      );
      return;
    }

    updateState({
      teams: makeTeams(
        state.boys,
        state.girls
      )
    });
  };

  // START TOURNAMENT
  const startTournament = () => {
    if (!isEditMode) return;

    if (state.teams.length !== 5) {
      return;
    }

    updateState({
      stage: "league",
      matches:
        makeRoundRobinFixtures(
          state.teams
        ),
      playoffs: clone(
        initialState.playoffs
      )
    });
  };

  // LEAGUE RESULT
  const submitLeagueResult = (
    matchId,
    result
  ) => {
    if (!isEditMode) return;

    if (
      !isResultValid(
        result,
        state.format
      )
    ) {
      alert(
        state.format === "single"
          ? "Enter two different scores before submitting."
          : "For Best of 3, one team must win 2 games. Leave unused games at 0–0."
      );

      return;
    }

    updateState((prev) => ({
      ...prev,
      matches: prev.matches.map(
        (m) =>
          m.id === matchId
            ? {
                ...m,
                status: "completed",
                result: clone(result)
              }
            : m
      )
    }));
  };

  // EDIT LEAGUE RESULT
  const editLeagueResult = (
    matchId
  ) => {
    if (!isEditMode) return;

    updateState((prev) => ({
      ...prev,
      matches: prev.matches.map(
        (m) =>
          m.id === matchId
            ? {
                ...m,
                status: "pending"
              }
            : m
      )
    }));
  };

  // PLAYOFF RESULT
  const submitPlayoffResult = (
    slot,
    result
  ) => {
    if (!isEditMode) return;

    if (
      !isResultValid(
        result,
        state.format
      )
    ) {
      alert(
        state.format === "single"
          ? "Enter two different scores before submitting."
          : "For Best of 3, one team must win 2 games. Leave unused games at 0–0."
      );

      return;
    }

    updateState((prev) => ({
      ...prev,

      playoffs: {
        ...prev.playoffs,

        [slot]: {
          status: "completed",
          result: clone(result)
        }
      },

      stage:
        slot === "final"
          ? "complete"
          : prev.stage
    }));
  };

  // EDIT PLAYOFF RESULT
  const editPlayoffResult = (
    slot
  ) => {
    if (!isEditMode) return;

    updateState((prev) => ({
      ...prev,

      playoffs: {
        ...prev.playoffs,
        [slot]: null
      },

      stage:
        slot === "final"
          ? "playoffs"
          : prev.stage
    }));
  };

  const playoffTeams =
    standings
      .slice(0, 4)
      .map((row) => row.teamId);

  const fifthTeam =
    standings[4]?.teamId;

  const q1 = {
    teamA: playoffTeams[0],
    teamB: playoffTeams[1]
  };

  const eliminator = {
    teamA: playoffTeams[2],
    teamB: playoffTeams[3]
  };

  const q1Winner =
    state.playoffs.q1?.result
      ? getWinner(
          state.playoffs.q1.result
        )
      : null;

  const q1Loser = q1Winner
    ? q1Winner === q1.teamA
      ? q1.teamB
      : q1.teamA
    : null;

  const elimWinner =
    state.playoffs.eliminator?.result
      ? getWinner(
          state.playoffs.eliminator.result
        )
      : null;

  const q2 =
    q1Loser && elimWinner
      ? {
          teamA: q1Loser,
          teamB: elimWinner
        }
      : null;

  const q2Winner =
    state.playoffs.q2?.result
      ? getWinner(
          state.playoffs.q2.result
        )
      : null;

  const final =
    q1Winner && q2Winner
      ? {
          teamA: q1Winner,
          teamB: q2Winner
        }
      : null;

  const champion =
    state.playoffs.final?.result
      ? getWinner(
          state.playoffs.final.result
        )
      : null;

  const formatLabel =
    state.format === "single"
      ? "Single Game"
      : "Best of 3";

  if (isLoading) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 18,
          fontWeight: 600
        }}
      >
        Loading tournament...
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">
            BADMINTON • MIXED DOUBLES
          </div>

          <h1>
            The K-EEDA Mixed Doubles Cup{" "}
            <span>🏸</span>
          </h1>
        </div>

        <div className="topbar-actions">
          {state.stage === "league" &&
            leagueComplete && (
              <button
                className="ghost-btn"
                onClick={() => {
                  setSelectedTeamId(null);

                  updateState({
                    stage: "playoffs"
                  });
                }}
              >
                Playoffs →
              </button>
            )}

          {isEditMode ? (
            <button
              className="ghost-btn"
              onClick={lockEditMode}
            >
              🔒 Lock Editing
            </button>
          ) : (
            <button
              className="ghost-btn"
              onClick={requestEditMode}
            >
              🔑 Admin Edit
            </button>
          )}

          {isEditMode && (
            <button
              className="ghost-btn"
              onClick={restartTournament}
            >
              Start New Tournament
            </button>
          )}
        </div>
      </header>

      <main>
        <div className="progress">
          <div
            className={
              state.stage === "setup"
                ? "progress-step active"
                : "progress-step"
            }
          >
            <span>1</span> Setup
          </div>

          <div
            className={
              state.stage === "league"
                ? "progress-step active"
                : "progress-step"
            }
          >
            <span>2</span> League Stage
          </div>

          <button
            className={
              (
                state.stage === "playoffs" ||
                state.stage === "complete"
                  ? "progress-step active"
                  : "progress-step"
              ) +
              (leagueComplete
                ? " clickable"
                : "")
            }
            onClick={() => {
              if (leagueComplete) {
                setSelectedTeamId(null);

                if (isEditMode) {
                  updateState({
                    stage: "playoffs"
                  });
                } else {
                  setState((prev) => ({
                    ...prev,
                    stage: "playoffs"
                  }));
                }
              }
            }}
            disabled={!leagueComplete}
          >
            <span>3</span> Playoffs
          </button>
        </div>

        {state.stage === "setup" && (
          <Setup
            state={state}
            updatePlayer={updatePlayer}
            updateState={updateState}
            pairTeams={pairTeams}
            startTournament={
              startTournament
            }
            allPlayersValid={
              allPlayersValid
            }
            canEdit={isEditMode}
          />
        )}

        {state.stage === "league" && (
          <League
            state={state}
            standings={standings}
            submitLeagueResult={
              submitLeagueResult
            }
            editLeagueResult={
              editLeagueResult
            }
            formatLabel={formatLabel}
            completedLeague={
              completedLeague
            }
            leagueComplete={
              leagueComplete
            }
            selectedTeamId={
              selectedTeamId
            }
            setSelectedTeamId={
              setSelectedTeamId
            }
            canEdit={isEditMode}
          />
        )}

        {(state.stage === "playoffs" ||
          state.stage === "complete") && (
          <Playoffs
            state={state}
            standings={standings}
            submitPlayoffResult={
              submitPlayoffResult
            }
            editPlayoffResult={
              editPlayoffResult
            }
            formatLabel={formatLabel}
            q1={q1}
            eliminator={eliminator}
            q2={q2}
            final={final}
            fifthTeam={fifthTeam}
            champion={champion}
            playoffTeams={
              playoffTeams
            }
            onTeamClick={(teamId) => {
              setSelectedTeamId(
                teamId
              );

              setState((prev) => ({
                ...prev,
                stage: "league"
              }));
            }}
            canEdit={isEditMode}
          />
        )}
      </main>

      <footer>
        <span>{formatLabel}</span>

        <span>•</span>

        <span>
          {isEditMode
            ? "EDIT MODE • Changes saved automatically"
            : "VIEW ONLY • Admin access required to edit"}
        </span>
      </footer>

      {showPasswordModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background:
              "rgba(0, 0, 0, 0.62)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            padding: 20
          }}
          onClick={() =>
            setShowPasswordModal(false)
          }
        >
          <div
            className="card"
            style={{
              width: "100%",
              maxWidth: 420,
              padding: 28,
              boxSizing: "border-box"
            }}
            onClick={(e) =>
              e.stopPropagation()
            }
          >
            <div className="eyebrow">
              ADMIN ACCESS
            </div>

            <h2 style={{ marginTop: 8 }}>
              Unlock editing
            </h2>

            <p className="muted">
              The tournament is currently
              view-only. Enter the admin
              password to edit players,
              teams and scores.
            </p>

            <input
              type="password"
              value={passwordInput}
              onChange={(e) => {
                setPasswordInput(
                  e.target.value
                );
                setPasswordError("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  unlockEditMode();
                }
              }}
              placeholder="Admin password"
              autoFocus
              style={{
                width: "100%",
                boxSizing: "border-box",
                padding: "12px 14px",
                marginTop: 12,
                borderRadius: 10,
                border:
                  "1px solid #ccc",
                fontSize: 16
              }}
            />

            {passwordError && (
              <div
                style={{
                  color: "#c62828",
                  marginTop: 8,
                  fontSize: 14
                }}
              >
                {passwordError}
              </div>
            )}

            <div
              className="actions"
              style={{
                marginTop: 18,
                display: "flex",
                gap: 10
              }}
            >
              <button
                className="primary-btn"
                onClick={() =>
                  setShowPasswordModal(
                    false
                  )
                }
                style={{
                  flex: 1,
                  width: "50%",
                  boxSizing: "border-box"
                }}
              >
                Cancel
              </button>

              <button
                className="primary-btn"
                onClick={
                  unlockEditMode
                }
                style={{
                  flex: 1,
                  width: "50%",
                  boxSizing: "border-box"
                }}
              >
                Unlock Editing
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Setup({
  state,
  updatePlayer,
  updateState,
  pairTeams,
  startTournament,
  allPlayersValid,
  canEdit
}) {
  return (
    <section className="page">
      <div className="hero">
        <div>
          <div className="pill">
            10 PLAYERS • 5 TEAMS
          </div>

          <h2>
            Set up your tournament.
          </h2>

          <p>
            Enter 5 boys and 5 girls.
            We’ll randomly create the
            mixed doubles teams.
          </p>
        </div>
      </div>

      <div className="setup-grid">
        <PlayerColumn
          title="Boys"
          icon="♂"
          players={state.boys}
          group="boys"
          updatePlayer={
            updatePlayer
          }
          canEdit={canEdit}
        />

        <PlayerColumn
          title="Girls"
          icon="♀"
          players={state.girls}
          group="girls"
          updatePlayer={
            updatePlayer
          }
          canEdit={canEdit}
        />
      </div>

      <div className="card format-card">
        <div>
          <div className="card-title">
            Match format
          </div>

          <div className="muted">
            This applies to every Round
            Robin and playoff fixture.
          </div>
        </div>

        <div className="segmented">
          <button
            className={
              state.format === "single"
                ? "selected"
                : ""
            }
            onClick={() =>
              updateState({
                format: "single"
              })
            }
            disabled={!canEdit}
          >
            Single Game
          </button>

          <button
            className={
              state.format === "bo3"
                ? "selected"
                : ""
            }
            onClick={() =>
              updateState({
                format: "bo3"
              })
            }
            disabled={!canEdit}
          >
            Best of 3
          </button>
        </div>
      </div>

      <div className="actions">
        <button
          className="primary-btn"
          onClick={pairTeams}
          disabled={!canEdit}
        >
          🎲 Randomly Pair Teams
        </button>
      </div>

      {state.teams.length === 5 && (
        <div className="card teams-card">
          <div className="section-heading">
            <div>
              <div className="card-title">
                Your teams
              </div>

              <div className="muted">
                Shuffle until everyone is
                happy, then start.
              </div>
            </div>

            <button
              className="secondary-btn"
              onClick={pairTeams}
              disabled={!canEdit}
            >
              ↻ Shuffle Again
            </button>
          </div>

          <div className="teams-grid">
            {state.teams.map(
              (team, index) => (
                <div
                  className="team-card"
                  key={team.id}
                >
                  <div className="team-number">
                    0{index + 1}
                  </div>

                  <div className="team-names">
                    <strong>
                      {team.name}
                    </strong>

                    <span>
                      {team.boy}
                    </span>

                    <span className="plus">
                      +
                    </span>

                    <span>
                      {team.girl}
                    </span>
                  </div>
                </div>
              )
            )}
          </div>

          <button
            className="primary-btn full"
            disabled={
              !allPlayersValid ||
              !canEdit
            }
            onClick={
              startTournament
            }
          >
            Start Round Robin →
          </button>
        </div>
      )}

      <div className="info-row">
        <div>
          🏆 <strong>10 fixtures</strong>

          <span>
            Every team plays the other
            4 teams once.
          </span>
        </div>

        <div>
          📊 <strong>Live table</strong>

          <span>
            Standings update only after
            results are submitted.
          </span>
        </div>

        <div>
          🔥 <strong>Playoffs</strong>

          <span>
            Top 4 teams continue after
            the league.
          </span>
        </div>
      </div>
    </section>
  );
}

function PlayerColumn({
  title,
  icon,
  players,
  group,
  updatePlayer,
  canEdit
}) {
  return (
    <div className="card player-card">
      <div className="section-heading">
        <div className="player-title">
          <span className="gender-icon">
            {icon}
          </span>

          {title}
        </div>

        <span className="count-badge">
          5
        </span>
      </div>

      {players.map(
        (player, index) => (
          <label
            className="player-input"
            key={player.id}
          >
            <span>
              {index + 1}
            </span>

            <input
              value={player.name}
              onChange={(e) =>
                updatePlayer(
                  group,
                  index,
                  e.target.value
                )
              }
              placeholder={`${title.slice(
                0,
                -1
              )} ${index + 1}`}
              maxLength={24}
              disabled={!canEdit}
            />
          </label>
        )
      )}
    </div>
  );
}

function League({
  state,
  standings,
  submitLeagueResult,
  editLeagueResult,
  formatLabel,
  completedLeague,
  leagueComplete,
  selectedTeamId,
  setSelectedTeamId,
  canEdit
}) {
  const selectedTeam =
    selectedTeamId
      ? teamById(
          state.teams,
          selectedTeamId
        )
      : null;

  if (selectedTeam) {
    return (
      <TeamLeagueRecord
        team={selectedTeam}
        teams={state.teams}
        matches={state.matches}
        formatLabel={formatLabel}
        onBack={() =>
          setSelectedTeamId(null)
        }
      />
    );
  }

  return (
    <section className="page">
      <div className="page-header">
        <div>
          <div className="pill">
            ROUND ROBIN
          </div>

          <h2>
            League stage
          </h2>

          <p>
            {completedLeague}/10 fixtures
            completed • {formatLabel}
          </p>
        </div>

        {leagueComplete && (
          <div className="ready-badge">
            ✓ Playoffs unlocked
          </div>
        )}
      </div>

      <Standings
        teams={state.teams}
        standings={standings}
        playoffView={false}
        onTeamClick={
          setSelectedTeamId
        }
      />

      <div className="section-title-row">
        <h3>Fixtures</h3>

        <span>
          Each matchup happens once
        </span>
      </div>

      <div className="fixtures">
        {Array.from(
          { length: 5 },
          (_, roundIndex) => {
            const roundMatches =
              state.matches.filter(
                (m) =>
                  m.round ===
                  roundIndex + 1
              );

            return (
              <div
                className="round-block"
                key={roundIndex}
              >
                <div className="round-label">
                  SLOT{" "}
                  {roundIndex + 1}
                </div>

                {roundMatches.map(
                  (match) => (
                    <MatchCard
                      key={match.id}
                      match={match}
                      teams={state.teams}
                      format={state.format}
                      onSubmit={
                        submitLeagueResult
                      }
                      onEdit={
                        editLeagueResult
                      }
                      canEdit={canEdit}
                    />
                  )
                )}
              </div>
            );
          }
        )}
      </div>
    </section>
  );
}

function TeamLeagueRecord({
  team,
  teams,
  matches,
  formatLabel,
  onBack
}) {
  const teamMatches =
    matches.filter(
      (match) =>
        match.status === "completed" &&
        match.result &&
        (match.teamA === team.id ||
          match.teamB === team.id)
    );

  const wins =
    teamMatches.filter(
      (match) =>
        getWinner(match.result) ===
        team.id
    ).length;

  const losses =
    teamMatches.length - wins;

  return (
    <section className="page">
      <div className="page-header">
        <div>
          <button
            className="ghost-btn"
            onClick={onBack}
          >
            ← League Standings
          </button>

          <div
            className="pill"
            style={{ marginTop: 16 }}
          >
            LEAGUE RECORD
          </div>

          <h2>
            {team.name}
          </h2>

          <p>
            {team.boy} + {team.girl} •{" "}
            {formatLabel}
          </p>
        </div>

        <div className="ready-badge">
          {wins}W • {losses}L
        </div>
      </div>

      <div className="card standings-card">
        <div className="section-heading">
          <div>
            <div className="card-title">
              {team.name} — League
              Matches
            </div>

            <div className="muted">
              League stage results only.
              Playoff scores are not shown
              or changed here.
            </div>
          </div>
        </div>

        <div className="record-list">
          {teamMatches.map((match) => {
            const teamIsA =
              match.teamA === team.id;

            const opponentId = teamIsA
              ? match.teamB
              : match.teamA;

            const opponent =
              teamById(
                teams,
                opponentId
              );

            const winner =
              getWinner(match.result);

            const won =
              winner === team.id;

            return (
              <div
                className="record-card"
                key={match.id}
              >
                <div className="record-match-info">
                  <span className="record-match-id">
                    {match.id}
                  </span>

                  <strong>
                    vs{" "}
                    {opponent?.name ||
                      "TBD"}
                  </strong>

                  <span>
                    {opponent?.boy} +{" "}
                    {opponent?.girl}
                  </span>
                </div>

                <div className="record-result">
                  <span
                    className={
                      won
                        ? "record-win"
                        : "record-loss"
                    }
                  >
                    {won
                      ? "WIN"
                      : "LOSS"}
                  </span>

                  {match.result.games ? (
                    <div className="record-games">
                      {match.result.games
                        .filter(
                          (game) =>
                            game.a !== 0 ||
                            game.b !== 0
                        )
                        .map(
                          (
                            game,
                            index
                          ) => (
                            <span
                              key={
                                index
                              }
                            >
                              {teamIsA
                                ? game.a
                                : game.b}
                              –
                              {teamIsA
                                ? game.b
                                : game.a}
                            </span>
                          )
                        )}
                    </div>
                  ) : (
                    <strong className="record-score">
                      {teamIsA
                        ? `${match.result.scoreA}–${match.result.scoreB}`
                        : `${match.result.scoreB}–${match.result.scoreA}`}
                    </strong>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function Standings({
  teams,
  standings,
  playoffView = false,
  onTeamClick
}) {
  return (
    <div className="card standings-card">
      <div className="section-heading">
        <div>
          <div className="card-title">
            Standings
          </div>

          <div className="muted">
            Ranked by wins → point margin →
            points scored
          </div>
        </div>

        <span className="live-dot">
          LIVE
        </span>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>POS</th>
              <th>TEAM</th>
              <th>P</th>
              <th>W</th>
              <th>L</th>
              <th>PF</th>
              <th>PA</th>
              <th>+/-</th>
            </tr>
          </thead>

          <tbody>
            {standings.map((row) => {
              const team =
                teamById(
                  teams,
                  row.teamId
                );

              return (
                <tr
                  key={row.teamId}
                  className={
                    playoffView
                      ? row.position === 5
                        ? "playoff-eliminated-row"
                        : "playoff-qualified-row"
                      : ""
                  }
                >
                  <td>
                    <span
                      className={
                        row.position <= 4
                          ? "rank top"
                          : "rank"
                      }
                    >
                      {row.position}
                    </span>
                  </td>

                  <td
                    onClick={() =>
                      onTeamClick?.(
                        team?.id
                      )
                    }
                    style={{
                      cursor: onTeamClick
                        ? "pointer"
                        : "default"
                    }}
                    title={
                      onTeamClick
                        ? `View ${team?.name} league record`
                        : undefined
                    }
                  >
                    <div className="table-team">
                      <strong>
                        {team?.name}
                      </strong>

                      <span>
                        {team?.boy} +{" "}
                        {team?.girl}
                      </span>
                    </div>
                  </td>

                  <td>
                    {row.played}
                  </td>

                  <td className="wins">
                    {row.wins}
                  </td>

                  <td>
                    {row.losses}
                  </td>

                  <td>
                    {row.pf}
                  </td>

                  <td>
                    {row.pa}
                  </td>

                  <td
                    className={
                      row.margin > 0
                        ? "positive"
                        : row.margin < 0
                        ? "negative"
                        : ""
                    }
                  >
                    {row.margin > 0
                      ? "+"
                      : ""}

                    {row.margin}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MatchCard({
  match,
  teams,
  format,
  onSubmit,
  onEdit,
  canEdit = false
}) {
  const [result, setResult] =
    useState(() =>
      match.result ||
      createBlankResult(
        match,
        format
      )
    );

  useEffect(() => {
    if (match.result) {
      setResult(
        clone(match.result)
      );
    }
  }, [match.result]);

  const teamA = teamById(
    teams,
    match.teamA
  );

  const teamB = teamById(
    teams,
    match.teamB
  );

  const changeSingle = (
    side,
    amount
  ) => {
    setResult((prev) => ({
      ...prev,
      [side]: Math.max(
        0,
        prev[side] + amount
      )
    }));
  };

  const changeGame = (
    gameIndex,
    side,
    amount
  ) => {
    setResult((prev) => ({
      ...prev,

      games: prev.games.map(
        (g, i) =>
          i === gameIndex
            ? {
                ...g,
                [side]: Math.max(
                  0,
                  g[side] + amount
                )
              }
            : g
      )
    }));
  };

  const winner = match.result
    ? getWinner(match.result)
    : null;

  return (
    <div
      className={`match-card ${
        match.status ===
        "completed"
          ? "completed"
          : ""
      }`}
    >
      <div className="match-meta">
        <span>
          {match.id}
        </span>

        {match.status ===
        "completed" ? (
          <span className="completed-label">
            ✓ Submitted
          </span>
        ) : (
          <span>
            Not played
          </span>
        )}
      </div>

      {format === "single" ? (
        <div className="single-score">
          <TeamScore
            team={teamA}
            score={result.scoreA}
            side="scoreA"
            onChange={changeSingle}
            winner={
              winner === teamA?.id
            }
            canEdit={canEdit}
          />

          <div className="vs">
            VS
          </div>

          <TeamScore
            team={teamB}
            score={result.scoreB}
            side="scoreB"
            onChange={changeSingle}
            winner={
              winner === teamB?.id
            }
            canEdit={canEdit}
          />
        </div>
      ) : (
        <div className="bo3">
          <div className="bo3-header">
            <span>Team</span>
            <span>G1</span>
            <span>G2</span>
            <span>G3</span>
          </div>

          {[
            {
              team: teamA,
              side: "a"
            },
            {
              team: teamB,
              side: "b"
            }
          ].map(
            ({ team, side }) => (
              <div
                className="bo3-row"
                key={team.id}
              >
                <div className="bo3-team">
                  {team.name}

                  <small>
                    {team.boy} +{" "}
                    {team.girl}
                  </small>
                </div>

                {[0, 1, 2].map(
                  (gameIndex) => (
                    <div
                      className="mini-score"
                      key={gameIndex}
                    >
                      <button
                        disabled={
                          !canEdit
                        }
                        onClick={() =>
                          changeGame(
                            gameIndex,
                            side,
                            -1
                          )
                        }
                      >
                        −
                      </button>

                      <strong>
                        {
                          result
                            .games[
                            gameIndex
                          ][side]
                        }
                      </strong>

                      <button
                        disabled={
                          !canEdit
                        }
                        onClick={() =>
                          changeGame(
                            gameIndex,
                            side,
                            1
                          )
                        }
                      >
                        +
                      </button>
                    </div>
                  )
                )}
              </div>
            )
          )}
        </div>
      )}

      {match.status ===
      "completed" ? (
        <div className="result-bar">
          <span>
            <strong>
              {teamLabel(
                teams,
                winner
              )}
            </strong>{" "}
            won
          </span>

          <span>
            {getScoreLabel(
              match.result
            )}
          </span>

          {canEdit && (
            <button
              className="text-btn"
              onClick={() =>
                onEdit(match.id)
              }
            >
              Edit result
            </button>
          )}
        </div>
      ) : (
        <button
          className="submit-btn"
          onClick={() =>
            onSubmit(
              match.id,
              result
            )
          }
          disabled={!canEdit}
        >
          Submit Result
        </button>
      )}
    </div>
  );
}

function TeamScore({
  team,
  score,
  side,
  onChange,
  winner,
  canEdit
}) {
  return (
    <div
      className={`score-team ${
        winner ? "winner" : ""
      }`}
    >
      <div className="score-team-name">
        <strong>
          {team.name}
        </strong>

        <span>
          {team.boy} +{" "}
          {team.girl}
        </span>
      </div>

      <div className="score-controls">
        <button
          disabled={!canEdit}
          onClick={() =>
            onChange(side, -1)
          }
        >
          −
        </button>

        <strong>
          {score}
        </strong>

        <button
          disabled={!canEdit}
          onClick={() =>
            onChange(side, 1)
          }
        >
          +
        </button>
      </div>
    </div>
  );
}

function Playoffs({
  state,
  standings,
  submitPlayoffResult,
  editPlayoffResult,
  formatLabel,
  q1,
  eliminator,
  q2,
  final,
  fifthTeam,
  champion,
  playoffTeams,
  onTeamClick,
  canEdit
}) {
  const complete = Boolean(champion);

  return (
    <section className="page">
      <div className="page-header">
        <div>
          <div className="pill">
            PLAYOFFS
          </div>

          <h2>
            {complete
              ? "Tournament complete 🏆"
              : "Playoffs"}
          </h2>

          <p>
            {formatLabel} • Top 4 continue,
            5th is eliminated
          </p>
        </div>
      </div>

      {complete && (
        <div className="champion">
          <div className="confetti">
            🏆
          </div>

          <div className="eyebrow">
            CHAMPIONS
          </div>

          <h2>
            {teamLabel(
              state.teams,
              champion
            )}
          </h2>

          <p>
            {teamMembers(
              state.teams,
              champion
            )}
          </p>

          <div className="champion-score">
            {getScoreLabel(
              state.playoffs.final
                .result
            )}
          </div>
        </div>
      )}

      <div className="bracket">
        <div className="bracket-column">
          <div className="bracket-heading">
            QUALIFIER 1
          </div>

          <div className="bracket-sub">
            1st vs 2nd • Winner → Final
          </div>

          <PlayoffMatch
            slot="q1"
            match={q1}
            playoff={
              state.playoffs.q1
            }
            teams={state.teams}
            format={state.format}
            onSubmit={
              submitPlayoffResult
            }
            onEdit={
              editPlayoffResult
            }
            canEdit={canEdit}
            disabled={
              !q1.teamA ||
              !q1.teamB
            }
          />
        </div>

        <div className="bracket-column">
          <div className="bracket-heading">
            ELIMINATOR
          </div>

          <div className="bracket-sub">
            3rd vs 4th • Loser out
          </div>

          <PlayoffMatch
            slot="eliminator"
            match={eliminator}
            playoff={
              state.playoffs
                .eliminator
            }
            teams={state.teams}
            format={state.format}
            onSubmit={
              submitPlayoffResult
            }
            onEdit={
              editPlayoffResult
            }
            canEdit={canEdit}
            disabled={
              !eliminator.teamA ||
              !eliminator.teamB
            }
          />
        </div>

        <div className="bracket-column">
          <div className="bracket-heading">
            QUALIFIER 2
          </div>

          <div className="bracket-sub">
            Q1 loser vs Eliminator
            winner
          </div>

          {q2 ? (
            <PlayoffMatch
              slot="q2"
              match={q2}
              playoff={
                state.playoffs.q2
              }
              teams={state.teams}
              format={state.format}
              onSubmit={
                submitPlayoffResult
              }
              onEdit={
                editPlayoffResult
              }
              canEdit={canEdit}
            />
          ) : (
            <div className="locked-card">
              🔒 Waiting for Q1 +
              Eliminator
            </div>
          )}
        </div>

        <div className="bracket-column final-column">
          <div className="bracket-heading">
            FINAL
          </div>

          <div className="bracket-sub">
            Winner takes the cup
          </div>

          {final ? (
            <PlayoffMatch
              slot="final"
              match={final}
              playoff={
                state.playoffs.final
              }
              teams={state.teams}
              format={state.format}
              onSubmit={
                submitPlayoffResult
              }
              onEdit={
                editPlayoffResult
              }
              canEdit={canEdit}
            />
          ) : (
            <div className="locked-card">
              🔒 Waiting for Qualifier
              2
            </div>
          )}
        </div>
      </div>

      <div className="playoff-standings">
        <div className="section-title-row">
          <div>
            <h3>
              League Stage Standings
            </h3>

            <span>
              Click any team to view its
              league record
            </span>
          </div>
        </div>

        <Standings
          teams={state.teams}
          standings={standings}
          playoffView={true}
          onTeamClick={onTeamClick}
        />
      </div>
    </section>
  );
}

function PlayoffMatch({
  slot,
  match,
  playoff,
  teams,
  format,
  onSubmit,
  onEdit,
  disabled,
  canEdit
}) {
  if (disabled) {
    return (
      <div className="locked-card">
        Waiting for league standings
      </div>
    );
  }

  const baseMatch = {
    id: slot.toUpperCase(),
    teamA: match.teamA,
    teamB: match.teamB
  };

  return (
    <MatchCard
      match={{
        ...baseMatch,
        status:
          playoff?.status ||
          "pending",
        result:
          playoff?.result || null
      }}
      teams={teams}
      format={format}
      onSubmit={(id, result) =>
        onSubmit(
          slot,
          result
        )
      }
      onEdit={() =>
        onEdit(slot)
      }
      canEdit={canEdit}
    />
  );
}

function teamMembers(
  teams,
  id
) {
  const team = teamById(
    teams,
    id
  );

  return team
    ? `${team.boy} + ${team.girl}`
    : "";
}

export default App;