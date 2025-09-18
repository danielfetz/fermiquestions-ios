// Supabase configuration
const SUPABASE_URL = 'https://hxyaaqdnbkpsdpreddsf.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh4eWFhcWRuYmtwc2RwcmVkZHNmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUyNTg3MTgsImV4cCI6MjA3MDgzNDcxOH0.ONL920tQUbG-ttVVhV4yuTof4V0Oc-WMBwWY1Q-VQXc';

// Initialize Supabase client
let supabase = null;
let currentUserId = null;
let commentsChannel = null;

const MAX_CONFIDENCE_PERCENT = 99;
const MAX_CONFIDENCE_FRACTION = MAX_CONFIDENCE_PERCENT / 100;

// Initialize Supabase with error handling
function initSupabase() {
    try {
        if (typeof window.supabase !== 'undefined') {
            supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
            console.log('Supabase initialized successfully');
            
            // Sign in anonymously and get/create user session
            initSupabaseAuth();
        } else {
            console.error('Supabase library not loaded');
        }
    } catch (error) {
        console.error('Error initializing Supabase:', error);
    }
}

// Initialize Supabase authentication
async function initSupabaseAuth() {
    if (!supabase) return;
    
    try {
        // Check if user already has a session
        const { data: { session } } = await supabase.auth.getSession();
        
        if (!session) {
            // Sign in anonymously
            const { data, error } = await supabase.auth.signInAnonymously();
            if (error) {
                console.error('Error signing in anonymously:', error);
            } else {
                currentUserId = data.user?.id;
                console.log('Anonymous user created:', currentUserId);
            }
        } else {
            currentUserId = session.user?.id;
            console.log('Existing user session:', currentUserId);
        }
        
        // Listen for auth changes
        supabase.auth.onAuthStateChange((event, session) => {
            currentUserId = session?.user?.id || null;
            console.log('Auth state changed:', event, currentUserId);
        });
    } catch (error) {
        console.error('Error with Supabase auth:', error);
    }
}

// Save game data to Supabase
async function saveGameToSupabase(gameData) {
    if (!supabase || !currentUserId) return;
    
    try {
        const { data, error } = await supabase
            .from('game_sessions')
            .upsert({
                user_id: currentUserId,
                question_date: gameData.question_date,
                question_text: gameData.question_text,
                correct_answer: gameData.correct_answer,
                won: gameData.won,
                total_guesses: gameData.total_guesses,
                guesses: gameData.guesses,
                completed_at: gameData.completed_at,
                created_at: new Date().toISOString()
            }, {
                onConflict: 'user_id,question_date'
            });
            
        if (error) {
            console.error('Error saving game to Supabase:', error);
        } else {
            console.log('Game saved to Supabase successfully');
        }
    } catch (error) {
        console.error('Error with Supabase save:', error);
    }
}

// Save stats to Supabase
async function saveStatsToSupabase(statsData) {
    if (!supabase || !currentUserId) return;
    
    try {
        const { data, error } = await supabase
            .from('user_stats')
            .upsert({
                user_id: currentUserId,
                games_played: statsData.gamesPlayed,
                games_won: statsData.gamesWon,
                win_rate: statsData.winRate,
                current_streak: statsData.currentStreak,
                max_streak: statsData.maxStreak,
                guess_distribution: statsData.guessDistribution,
                updated_at: new Date().toISOString()
            }, {
                onConflict: 'user_id'
            });
            
        if (error) {
            console.error('Error saving stats to Supabase:', error);
        } else {
            console.log('Stats saved to Supabase successfully');
        }
    } catch (error) {
        console.error('Error with Supabase stats save:', error);
    }
}

// Fetch average guesses for a question from Supabase using RPC
async function fetchAverageGuesses(questionDate) {
    if (!supabase) return null;
    
    try {
        // Call the RPC function for server-side aggregation
        const { data, error } = await supabase
            .rpc('avg_guesses_for_date', { q_date: questionDate });
        
        if (error) {
            console.error('Error fetching average guesses:', error);
            return null;
        }
        
        // The RPC returns an array with one row
        if (!data || data.length === 0) {
            return null;
        }
        
        const result = data[0];
        
        // Return null if no players have completed this question yet
        if (!result || result.total_players === 0) {
            return null;
        }
        
        return {
            average: parseFloat(result.average),
            totalPlayers: result.total_players,
            winRate: result.win_rate
        };
    } catch (error) {
        console.error('Error with average guesses fetch:', error);
        return null;
    }
}

// Fetch median of first guesses for a question.
// Tries RPC 'median_first_guess_for_date' first; falls back to client aggregation from game_sessions.
async function fetchMedianFirstGuess(questionDate) {
    if (!supabase) return null;
    // Try server-side RPC (preferred)
    try {
        const { data, error } = await supabase
            .rpc('median_first_guess_for_date', { q_date: questionDate });
        if (!error && data && data.length > 0) {
            const row = data[0];
            if (row && row.median != null) {
                const value = typeof row.median === 'string' ? parseFloat(row.median) : row.median;
                if (!isNaN(value)) return Math.round(value);
            }
        }
    } catch (err) {
        // ignore and try fallback
    }
    // Fallback: read first guesses from game_sessions JSON and compute client-side
    try {
        const { data, error } = await supabase
            .from('game_sessions')
            .select('guesses, completed_at')
            .eq('question_date', questionDate)
            .not('guesses', 'is', null);
        if (error || !data) return null;
        const firstGuesses = [];
        for (const row of data) {
            const list = Array.isArray(row.guesses) ? row.guesses : null;
            if (!list || list.length === 0) continue;
            const first = list[0];
            if (!first || first.value == null) continue;
            const num = parseInt(String(first.value).replace(/[^\d]/g, ''));
            if (!isNaN(num)) firstGuesses.push(num);
        }
        if (firstGuesses.length === 0) return null;
        firstGuesses.sort((a, b) => a - b);
        const mid = Math.floor(firstGuesses.length / 2);
        if (firstGuesses.length % 2 === 0) {
            return Math.round((firstGuesses[mid - 1] + firstGuesses[mid]) / 2);
        }
        return firstGuesses[mid];
    } catch (err) {
        return null;
    }
}

// Compute the percentile of the user's first guess among all first guesses for this date
// Attempts RPC 'first_guess_percentile_for_date' first; falls back to client aggregation
async function fetchFirstGuessPercentile(questionDate) {
    if (!supabase) return null;
    // get user's first guess from current game or saved data
    let userFirstGuess = null;
    try {
        const guessRows = guessesContainer.querySelectorAll('.guess-row');
        if (guessRows.length > 0) {
            const firstRow = guessRows[0];
            const guessField = firstRow.querySelector('.guess-field');
            if (guessField && guessField.textContent) {
                const n = parseInt(String(guessField.textContent).replace(/[^\d]/g, ''));
                if (!isNaN(n)) userFirstGuess = n;
            }
        }
    } catch (e) {
        // ignore
    }
    if (userFirstGuess == null) return null;

    // Try RPC
    try {
        const { data, error } = await supabase
            .rpc('first_guess_percentile_for_date', { q_date: questionDate, g_value: userFirstGuess });
        if (!error && data && data.length > 0) {
            const row = data[0];
            if (row && typeof row.percentile === 'number') return row.percentile;
        }
    } catch (e) {
        // ignore and fallback
    }

    // Fallback: compute percentile client-side from game_sessions based on closeness to the correct answer
    try {
        const { data, error } = await supabase
            .from('game_sessions')
            .select('guesses')
            .eq('question_date', questionDate)
            .not('guesses', 'is', null);
        if (error || !data) return null;
        const values = [];
        for (const row of data) {
            const list = Array.isArray(row.guesses) ? row.guesses : null;
            if (!list || list.length === 0) continue;
            const first = list[0];
            if (!first || first.value == null) continue;
            const num = parseInt(String(first.value).replace(/[^\d]/g, ''));
            if (!isNaN(num)) values.push(num);
        }
        if (values.length === 0) return null;
        if (!currentQuestion || !currentQuestion.answer) return null;
        const correct = Number(currentQuestion.answer);
        if (!isFinite(correct) || correct <= 0) return null;
        if (!(userFirstGuess > 0)) return null;
        // log-scale error (symmetric, multiplicative)
        const userErr = Math.abs(Math.log(userFirstGuess) - Math.log(correct));
        const errors = values
            .filter(v => v > 0)
            .map(v => Math.abs(Math.log(v) - Math.log(correct)))
            .filter(e => isFinite(e));
        if (errors.length === 0) return null;
        // percentile rank by closeness: percentage of players with error >= user's error
        let countGE = 0;
        for (const e of errors) if (e >= userErr) countGE++;
        const percentile = Math.round((countGE / errors.length) * 100);
        return percentile;
    } catch (e) {
        return null;
    }
}

// Fetch comments for a question
async function fetchComments(questionDate) {
    if (!supabase) return [];
    try {
        const { data, error } = await supabase
            .from('comments')
            .select('id, content, guess_count, won, created_at')
            .eq('question_date', questionDate)
            .order('created_at', { ascending: false });
        if (error || !data) return [];
        return data;
    } catch (e) {
        console.error('Error fetching comments:', e);
        return [];
    }
}

// Add a comment
async function addComment(questionDate, content) {
    if (!supabase || !currentUserId) return;
    const guessCount = getGuessCountForComment();
    const completed = completedQuestions[currentQuestion.date];
    const won = completed ? completed.won : gameWon;
    try {
        await supabase
            .from('comments')
            .insert({
                user_id: currentUserId,
                question_date: questionDate,
                content,
                guess_count: guessCount,
                won,
                created_at: new Date().toISOString()
            });
    } catch (e) {
        console.error('Error adding comment:', e);
    }
}

function getGuessCountForComment() {
    if (!currentQuestion) return null;
    const completed = completedQuestions[currentQuestion.date];
    if (completed && typeof completed.guesses === 'number') {
        return completed.guesses;
    }
    if (gameOver) return currentGuess;
    return null;
}

function formatTimeAgo(dateString) {
    const now = new Date();
    const date = new Date(dateString);
    const diffMs = now - date;
    const diffMinutes = Math.floor(diffMs / 60000);
    if (diffMinutes < 1) return 'just now';
    if (diffMinutes < 60) {
        return diffMinutes === 1 ? '1 minute ago' : `${diffMinutes} minutes ago`;
    }
    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) {
        return diffHours === 1 ? '1 hour ago' : `${diffHours} hours ago`;
    }
    const diffDays = Math.floor(diffHours / 24);
    return diffDays === 1 ? '1 day ago' : `${diffDays} days ago`;
}

// Load comments and update display
async function loadComments() {
    if (!currentQuestion) return;
    const comments = await fetchComments(currentQuestion.date);
    renderComments(comments);
    if (commentCountEl) commentCountEl.textContent = comments.length;
}

function renderComments(comments) {
    if (!commentsList) return;
    commentsList.innerHTML = '';
    if (!comments || comments.length === 0) {
        const empty = document.createElement('p');
        empty.textContent = 'No comments yet';
        commentsList.appendChild(empty);
        return;
    }
    comments.forEach(c => {
        const div = document.createElement('div');
        div.className = 'comment';

        const textEl = document.createElement('div');
        textEl.className = 'comment-text';
        textEl.textContent = c.content;
        div.appendChild(textEl);

        const metaEl = document.createElement('div');
        metaEl.className = 'comment-meta';
        const timeAgo = formatTimeAgo(c.created_at);
        if (c.won === false) {
            metaEl.textContent = `Lost · ${timeAgo}`;
        } else if (c.guess_count != null) {
            const tries = `${c.guess_count}/6 tries`;
            metaEl.textContent = `${tries} · ${timeAgo}`;
        } else {
            metaEl.textContent = timeAgo;
        }
        div.appendChild(metaEl);

        commentsList.appendChild(div);
    });
}

async function updateCommentCount() {
    if (!currentQuestion || !commentCountEl) return;
    const comments = await fetchComments(currentQuestion.date);
    commentCountEl.textContent = comments.length;
}

function subscribeToComments(questionDate) {
    if (!supabase) return;
    if (commentsChannel) {
        supabase.removeChannel(commentsChannel);
    }
    commentsChannel = supabase
        .channel(`comments-${questionDate}`)
        .on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: 'comments',
            filter: `question_date=eq.${questionDate}`
        }, async () => {
            await updateCommentCount();
            if (commentsSection && commentsSection.classList.contains('open')) {
                await loadComments();
            }
        })
        .subscribe();
}

function openComments() {
    if (!commentsSection) return;
    loadComments();
    commentsSection.classList.add('open');
    document.body.classList.add('no-scroll');
}

function closeComments() {
    if (!commentsSection) return;
    commentsSection.classList.remove('open');
    document.body.classList.remove('no-scroll');
}

// Update the average tries display in the inline meta row
// Inline avg display removed entirely

// Game state
let currentQuestion = null;
let currentGuess = 0;
let maxGuesses = 6;
let gameWon = false;
let gameOver = false;
let completedQuestions = {}; // Changed from array to object to track win/loss status

// URL Routing state
let isNavigating = false;
let currentView = 'welcome';
let todaysQuestion = null;

// Statistics
let stats = {
    gamesPlayed: 0,
    gamesWon: 0,
    winRate: 0,
    currentStreak: 0,
    maxStreak: 0,
    guessDistribution: {
        1: 0,
        2: 0,
        3: 0,
        4: 0,
        5: 0,
        6: 0
    },
    calibrationData: []
};

let calibrationEnabled = true;

// Database of Fermi questions with dates
const fermiQuestions = [
    {
        question: "How many people live outside the country where they were born?",
        answer: 304000000,
        category: "",
        explanation: "",
        hint: "About 20% of Germany's population was born in another country.",
        date: "2025-07-24",
        image: "data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'%3e%3crect width='100' height='100' fill='%23f0f8ff'/%3e%3ctext x='50' y='62' font-size='40' text-anchor='middle' fill='%234169e1'%3e🌍%3c/text%3e%3c/svg%3e"
    },
    {
        question: "How many people of Jewish faith live in the world?",
        answer: 15800000,
        category: "Religion",
        explanation: "",
        hint: "Appx. 45.5% of the world's Jewish population lives in Israel.",
        date: "2025-07-25",
        image: "data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'%3e%3crect width='100' height='100' fill='%23f8fafc'/%3e%3ctext x='50' y='62' font-size='40' text-anchor='middle' fill='%23374151'%3e✡️%3c/text%3e%3c/svg%3e"
    },
    {
        question: "How many McDonald's restaurants exist worldwide?",
        answer: 43477,
        category: "Business",
        explanation: "McDonald's operates approximately 43,500 restaurants globally.",
        hint: "There are 13,557 McDonald's restaurants in the US.",
        date: "2025-07-26",
        image: "data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'%3e%3crect width='100' height='100' fill='%23fef3c7'/%3e%3ctext x='50' y='62' font-size='40' text-anchor='middle' fill='%23dc2626'%3e🍟%3c/text%3e%3c/svg%3e"
    },
    {
        question: "How many new electric cars/plug-in hybrids were sold worldwide in 2024?",
        answer: 17500000,
        category: "",
        explanation: "",
        hint: "62.9M new non-electric cars were sold worldwide in 2023.",
        date: "2025-07-27",
        image: "data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'%3e%3crect width='100' height='100' fill='%23dcfce7'/%3e%3ctext x='50' y='62' font-size='40' text-anchor='middle' fill='%2316a34a'%3e🔋%3c/text%3e%3c/svg%3e"
    },
    {
        question: "How many new smartphones were sold worldwide in 2024?",
        answer: 1240000000,
        category: "",
        explanation: "",
        hint: "Xiaomi sold 169 million smartphones in 2024.",
        date: "2025-07-28",
        image: "data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'%3e%3crect width='100' height='100' fill='%23f3f4f6'/%3e%3ctext x='50' y='62' font-size='40' text-anchor='middle' fill='%23374151'%3e📱%3c/text%3e%3c/svg%3e"
    },
    {
        question: "How many cars did Tesla produce in 2024?",
        answer: 1770000,
        category: "",
        explanation: "",
        hint: "In 2018, Tesla produced 255K cars.",
        date: "2025-07-29",
        image: "data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'%3e%3crect width='100' height='100' fill='%23fef2f2'/%3e%3ctext x='50' y='62' font-size='40' text-anchor='middle' fill='%23dc2626'%3e🚗%3c/text%3e%3c/svg%3e"
    },
    {
        question: "What percentage of the Earth's surface is land?",
        answer: 29,
        category: "",
        explanation: "",
        hint: "The US covers 1.87% of the Earth's surface.",
        date: "2025-07-30",
        image: "data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'%3e%3crect width='100' height='100' fill='%23dbeafe'/%3e%3ctext x='50' y='62' font-size='40' text-anchor='middle' fill='%232563eb'%3e🌍%3c/text%3e%3c/svg%3e"
    },
    {
        question: "How many chickens were slaughtered for meat worldwide in 2023?",
        answer: 76250000000,
        category: "",
        explanation: "",
        hint: "The average meat yield per chicken is 1.66 kg.",
        date: "2025-07-31",
        image: "data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'%3e%3crect width='100' height='100' fill='%23fffbeb'/%3e%3ctext x='50' y='62' font-size='40' text-anchor='middle' fill='%23d97706'%3e🐔%3c/text%3e%3c/svg%3e"
    },
    {
        question: "How many humans have ever lived (including those currently alive)?",
        answer: 117000000000,
        category: "",
        explanation: "",
        hint: "About half the people who ever lived, lived in the past 2000 years.",
        date: "2025-08-01",
        image: "data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'%3e%3crect width='100' height='100' fill='%23fef7cd'/%3e%3ctext x='50' y='62' font-size='40' text-anchor='middle' fill='%23a16207'%3e👥%3c/text%3e%3c/svg%3e"
    },
    {
        question: "How many new cars were sold in the United States in 2024?",
        answer: 15900000,
        category: "",
        explanation: "",
        hint: "Around 240 million people hold a valid driver's licence in the US.",
        date: "2025-08-02",
        image: "data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'%3e%3crect width='100' height='100' fill='%23eff6ff'/%3e%3ctext x='50' y='62' font-size='40' text-anchor='middle' fill='%232563eb'%3e🚙%3c/text%3e%3c/svg%3e"
    },
    {
        question: "How many veterinarians are there in the United States?",
        answer: 130415,
        category: "",
        explanation: "",
        hint: "There are about 15,000 veterinarians in Australia.",
        date: "2025-08-03",
        image: "data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'%3e%3crect width='100' height='100' fill='%23f0fdf4'/%3e%3ctext x='50' y='62' font-size='40' text-anchor='middle' fill='%2316a34a'%3e🐈%3c/text%3e%3c/svg%3e"
    },
    {
        question: "How many paying subscribers does Spotify have?",
        answer: 276000000,
        category: "",
        explanation: "",
        hint: "Spotify's revenue in the second quarter of 2025 was 4.2 billion euros.",
        date: "2025-08-04",
        image: "data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'%3e%3crect width='100' height='100' fill='%23f0fdf4'/%3e%3ctext x='50' y='62' font-size='40' text-anchor='middle' fill='%2316a34a'%3e🎵%3c/text%3e%3c/svg%3e"
    },
    {
        question: "How many iPhones has Apple ever sold?",
        answer: 3000000000,
        category: "",
        explanation: "",
        hint: "In 2024, Apple sold approximately 232.1 million iPhones.",
        date: "2025-08-05",
        image: "data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'%3e%3crect width='100' height='100' fill='%23f8fafc'/%3e%3ctext x='50' y='62' font-size='40' text-anchor='middle' fill='%23374151'%3e📱%3c/text%3e%3c/svg%3e"
    },
    {
        question: "How many students are currently enrolled in medical school in the US?",
        answer: 99562,
        category: "",
        explanation: "",
        hint: "The US had 1,01 million active physicians in 2023.",
        date: "2025-08-06",
        image: "data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'%3e%3crect width='100' height='100' fill='%23fef2f2'/%3e%3ctext x='50' y='62' font-size='40' text-anchor='middle' fill='%23dc2626'%3e🏥%3c/text%3e%3c/svg%3e"
    },
    {
        question: "How many pigs were slaughtered for meat worldwide in 2023?",
        answer: 1510000000,
        category: "",
        explanation: "",
        hint: "The average meat yield per pig is 82 kg (181 lbs).",
        date: "2025-08-07",
        image: "data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'%3e%3crect width='100' height='100' fill='%23fdf2f8'/%3e%3ctext x='50' y='62' font-size='40' text-anchor='middle' fill='%23ec4899'%3e🐷%3c/text%3e%3c/svg%3e"
    },
    {
        question: "How many passengers did the San Francisco Airport handle in 2024?",
        answer: 52300000,
        category: "",
        explanation: "",
        hint: "1.35M passengers were flown from SFO to Taiwan in 2024.",
        date: "2025-08-08",
        image: "data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'%3e%3crect width='100' height='100' fill='%23f0f8ff'/%3e%3ctext x='50' y='62' font-size='40' text-anchor='middle' fill='%234169e1'%3e✈️%3c/text%3e%3c/svg%3e"
    },
    {
        question: "How many printed books has Amazon sold in the United States in 2024?",
        answer: 308000000,
        category: "",
        explanation: "",
        hint: "In France, retailers sold 440 million print books in 2023.",
        date: "2025-08-09",
        image: "data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'%3e%3crect width='100' height='100' fill='%23f0fdf4'/%3e%3ctext x='50' y='62' font-size='40' text-anchor='middle' fill='%2316a34a'%3e📚%3c/text%3e%3c/svg%3e"
    },
    {
        question: "How many babies were born worldwide in 2024?",
        answer: 132000000,
        category: "",
        explanation: "",
        hint: "For every person that died in 2024, more than two babies were born.",
        date: "2025-08-10",
        image: "data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'%3e%3crect width='100' height='100' fill='%23fffbeb'/%3e%3ctext x='50' y='62' font-size='40' text-anchor='middle' fill='%23d97706'%3e👶%3c/text%3e%3c/svg%3e"
    },
    {
        question: "How many air traffic controllers are there in the United States?",
        answer: 14264,
        category: "",
        explanation: "",
        hint: "There are 527 airport traffic control towers in the US.",
        date: "2025-08-11",
        image: "data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'%3e%3crect width='100' height='100' fill='%23f8fafc'/%3e%3ctext x='50' y='62' font-size='40' text-anchor='middle' fill='%23374151'%3e🧭%3c/text%3e%3c/svg%3e"
    },
    {
        question: "How many sheep are there in the world?",
        answer: 1266000000,
        category: "",
        explanation: "",
        hint: "A single sheep provides around 4.5 kg of wool per year.",
        date: "2025-08-12",
        image: "data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'%3e%3crect width='100' height='100' fill='%23f8fafc'/%3e%3ctext x='50' y='62' font-size='40' text-anchor='middle' fill='%23374151'%3e🐑%3c/text%3e%3c/svg%3e"
    },
    {
        question: "How many dentists work in the United Kingdom?",
        answer: 45580,
        category: "",
        explanation: "",
        hint: "There are 11,976 dental practices in the UK.",
        date: "2025-08-13",
        image: "data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'%3e%3crect width='100' height='100' fill='%23f8fafc'/%3e%3ctext x='50' y='62' font-size='40' text-anchor='middle' fill='%23374151'%3e🦷%3c/text%3e%3c/svg%3e"
    },
    {
        question: "How many public school teachers are there in California?",
        answer: 285891,
        category: "",
        explanation: "",
        hint: "There are around 10,000 public schools in California.",
        date: "2025-08-14",
        image: "data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'%3e%3crect width='100' height='100' fill='%23f8fafc'/%3e%3ctext x='50' y='62' font-size='40' text-anchor='middle' fill='%23374151'%3e👩‍🏫%3c/text%3e%3c/svg%3e"
    },
    {
        question: "How many weddings took place in the United States in 2022?",
        answer: 2070000,
        category: "",
        explanation: "",
        hint: "673,989 divorces happened in the US in 2022.",
        date: "2025-08-15",
        image: "data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'%3e%3crect width='100' height='100' fill='%23f8fafc'/%3e%3ctext x='50' y='62' font-size='40' text-anchor='middle' fill='%23374151'%3e💍%3c/text%3e%3c/svg%3e"
    },
    {
        question: "How many police officers are there across the European Union?",
        answer: 1537588,
        category: "",
        explanation: "",
        hint: "Finland has around 135 police officers per 100,000 inhabitants.",
        date: "2025-08-16",
        image: "data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'%3e%3crect width='100' height='100' fill='%23f8fafc'/%3e%3ctext x='50' y='62' font-size='40' text-anchor='middle' fill='%23374151'%3e🚓%3c/text%3e%3c/svg%3e"
    },
    {
        question: "How many Americans who served in World War II were still alive as of 2024?",
        answer: 66143,
        category: "",
        explanation: "",
        hint: "Around 16.4 million Americans served in World War II.",
        date: "2025-08-17",
        image: "data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'%3e%3crect width='100' height='100' fill='%23f8fafc'/%3e%3ctext x='50' y='62' font-size='40' text-anchor='middle' fill='%23374151'%3e🪖%3c/text%3e%3c/svg%3e"
    },
    {
        question: "How many airports are there in the US, including small private airstrips?",
        answer: 19482,
        category: "",
        explanation: "",
        hint: "Around 26% of all US airports are open to the public.",
        date: "2025-08-18",
        image: "data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'%3e%3crect width='100' height='100' fill='%23f8fafc'/%3e%3ctext x='50' y='62' font-size='40' text-anchor='middle' fill='%23374151'%3e🛫%3c/text%3e%3c/svg%3e"
    },
    {
        question: "How many lawyers are there in the United States?",
        answer: 1322649,
        category: "",
        explanation: "",
        hint: "In 1970, there were 326,000 lawyers in the US.",
        date: "2025-08-19",
        image: "data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'%3e%3crect width='100' height='100' fill='%23f8fafc'/%3e%3ctext x='50' y='62' font-size='40' text-anchor='middle' fill='%23374151'%3e🏛️%3c/text%3e%3c/svg%3e"
    },
    {
        question: "How many horses are there in the United States?",
        answer: 6700000,
        category: "",
        explanation: "",
        hint: "The horse population has declined by more than two-thirds since it peaked in 1920.",
        date: "2025-08-20",
        image: "data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'%3e%3crect width='100' height='100' fill='%23f8fafc'/%3e%3ctext x='50' y='62' font-size='40' text-anchor='middle' fill='%23374151'%3e🐴%3c/text%3e%3c/svg%3e"
    },
    {
        question: "How much revenue in US dollars did Meta/Facebook make per day in 2024?",
        answer: 450000000,
        category: "",
        explanation: "",
        hint: "In December 2024, Meta's apps reached 3.35 billion people daily.",
        date: "2025-08-21",
        image: "data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'%3e%3crect width='100' height='100' fill='%23f8fafc'/%3e%3ctext x='50' y='62' font-size='40' text-anchor='middle' fill='%23374151'%3e📱%3c/text%3e%3c/svg%3e"
    },
    {
        question: "How many passengers fly in and out of US airports every day?",
        answer: 3000000,
        category: "",
        explanation: "",
        hint: "The FAA handles on average more than 44,000 flights per day.",
        date: "2025-08-22",
        image: "data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'%3e%3crect width='100' height='100' fill='%23f8fafc'/%3e%3ctext x='50' y='62' font-size='40' text-anchor='middle' fill='%23374151'%3e✈️%3c/text%3e%3c/svg%3e"
    },
    {
        question: "How many new cars did Toyota sell globally in 2024?",
        answer: 10200000,
        category: "",
        explanation: "",
        hint: "In 2024, Toyoto sold around 2.33 million cars in the US.",
        date: "2025-08-23",
        image: "data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'%3e%3crect width='100' height='100' fill='%23f8fafc'/%3e%3ctext x='50' y='62' font-size='40' text-anchor='middle' fill='%23374151'%3e🚗️%3c/text%3e%3c/svg%3e"
    },
    {
        question: "How many golf courses are there in the United States?",
        answer: 15963,
        category: "",
        explanation: "",
        hint: "In 2024, around 28 million people played on a golf course in the US.",
        date: "2025-08-24",
        image: "data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'%3e%3crect width='100' height='100' fill='%23f8fafc'/%3e%3ctext x='50' y='62' font-size='40' text-anchor='middle' fill='%23374151'%3e⛳️%3c/text%3e%3c/svg%3e"
    },
    {
        question: "How many PCs (desktops and laptops) were sold globally in 2024?",
        answer: 245300000,
        category: "",
        explanation: "",
        hint: "Dell was the third-largest PC vendor in 2024, selling 39.5 million units.",
        date: "2025-08-25",
        image: "data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'%3e%3crect width='100' height='100' fill='%23f8fafc'/%3e%3ctext x='50' y='62' font-size='40' text-anchor='middle' fill='%23374151'%3e💻%3c/text%3e%3c/svg%3e"
    },
    {
        question: "How many waiters and waitresses are there in the United States?",
        answer: 2280000,
        category: "",
        explanation: "",
        hint: "Per capita food-away-from-home expenditure was $4,306 in 2024.",
        date: "2025-08-26",
        image: "data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'%3e%3crect width='100' height='100' fill='%23f8fafc'/%3e%3ctext x='50' y='62' font-size='40' text-anchor='middle' fill='%23374151'%3e🍽️%3c/text%3e%3c/svg%3e"
    },
    {
        question: "How many people worldwide speak English as a native or second language?",
        answer: 1528000000,
        category: "",
        explanation: "",
        hint: "There are around 390 million native English speakers in the world.",
        date: "2025-08-27",
        image: "data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'%3e%3crect width='100' height='100' fill='%23f8fafc'/%3e%3ctext x='50' y='62' font-size='40' text-anchor='middle' fill='%23374151'%3e💬%3c/text%3e%3c/svg%3e"
    },
    {
        question: "What percentage of the Earth's land surface is covered by forest?",
        answer: 31,
        category: "",
        explanation: "",
        hint: "Around 76% of the Earth's land surface is habitable.",
        date: "2025-08-28",
        image: "data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'%3e%3crect width='100' height='100' fill='%23f8fafc'/%3e%3ctext x='50' y='62' font-size='40' text-anchor='middle' fill='%23374151'%3e🌲%3c/text%3e%3c/svg%3e"
    },
    {
        question: "How many visitors did Disneyland Paris have in 2023?",
        answer: 16100000,
        category: "",
        explanation: "",
        hint: "The Louvre Museum had 8.9 million visitors in 2023.",
        date: "2025-08-29",
        image: "data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'%3e%3crect width='100' height='100' fill='%23f8fafc'/%3e%3ctext x='50' y='62' font-size='40' text-anchor='middle' fill='%23374151'%3e🎢%3c/text%3e%3c/svg%3e"
    },
    {
        question: "How many people worldwide were 80 years or older in 2021?",
        answer: 155000000,
        category: "",
        explanation: "",
        hint: "The UN estimates that 459 million people will be aged 80 or older by 2050.",
        date: "2025-08-30",
        image: "data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'%3e%3crect width='100' height='100' fill='%23f8fafc'/%3e%3ctext x='50' y='62' font-size='40' text-anchor='middle' fill='%23374151'%3e👵%3c/text%3e%3c/svg%3e"
    },
    {
        question: "How many pharmacies are there in the United Kingdom?",
        answer: 13822,
        category: "",
        explanation: "",
        hint: "There are around 1300 pharmacies in Scotland alone.",
        date: "2025-08-31",
        image: "data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'%3e%3crect width='100' height='100' fill='%23f8fafc'/%3e%3ctext x='50' y='62' font-size='40' text-anchor='middle' fill='%23374151'%3e💊%3c/text%3e%3c/svg%3e"
    },
    {
        question: "How many electricians are there in the United States?",
        answer: 818700,
        category: "",
        explanation: "",
        hint: "In 2024, roughly 1.02 million single-family homes finished construction in the US.",
        date: "2025-09-01",
        image: "data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'%3e%3crect width='100' height='100' fill='%23f8fafc'/%3e%3ctext x='50' y='62' font-size='40' text-anchor='middle' fill='%23374151'%3e🔌%3c/text%3e%3c/svg%3e"
    },
    {
        question: "How much revenue in US dollars did Reddit make in the first half of 2025?",
        answer: 892000000,
        category: "",
        explanation: "",
        hint: "Reddit's revenue per daily active user was $4.53 in the second quarter of 2025.",
        date: "2025-09-02",
        image: "data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'%3e%3crect width='100' height='100' fill='%23f8fafc'/%3e%3ctext x='50' y='62' font-size='40' text-anchor='middle' fill='%23374151'%3e💰%3c/text%3e%3c/svg%3e"
    },
    {
        question: "How many native Spanish speakers are there worldwide?",
        answer: 498500000,
        category: "",
        explanation: "",
        hint: "Mexico, Colombia, and Argentina all have more native Spanish speakers than Spain.",
        date: "2025-09-03",
        image: "data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'%3e%3crect width='100' height='100' fill='%23f8fafc'/%3e%3ctext x='50' y='62' font-size='40' text-anchor='middle' fill='%23374151'%3e🇪🇸%3c/text%3e%3c/svg%3e"
    },
    {
        question: "How many elevators are there in Germany, excluding stair lifts?",
        answer: 815000,
        category: "",
        explanation: "",
        hint: "In 2021, 56% of Germany's 83 million residents lived in apartment buildings.",
        date: "2025-09-04",
        image: "data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'%3e%3crect width='100' height='100' fill='%23f8fafc'/%3e%3ctext x='50' y='62' font-size='40' text-anchor='middle' fill='%23374151'%3e🛗%3c/text%3e%3c/svg%3e"
    },
    {
        question: "How many undergraduate students are there in the United Kingdom?",
        answer: 2050000,
        category: "",
        explanation: "",
        hint: "Around 749,000 babies were born in the United Kingdom in 2006.",
        date: "2025-09-05",
        image: "data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'%3e%3crect width='100' height='100' fill='%23f8fafc'/%3e%3ctext x='50' y='62' font-size='40' text-anchor='middle' fill='%23374151'%3e🏛️%3c/text%3e%3c/svg%3e"
    },
    {
        question: "How many cars were produced in China in 2024?",
        answer: 27480000,
        category: "",
        explanation: "",
        hint: "China exported 4.96 million cars in 2024.",
        date: "2025-09-06",
        image: "data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'%3e%3crect width='100' height='100' fill='%23f8fafc'/%3e%3ctext x='50' y='62' font-size='40' text-anchor='middle' fill='%23374151'%3e🚗%3c/text%3e%3c/svg%3e"
    },
    {
        question: "How many Catholic priests are there worldwide?",
        answer: 407000,
        category: "",
        explanation: "",
        hint: "The number of baptized Catholics was around 1.4 billion in 2022.",
        date: "2025-09-07",
        image: "data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'%3e%3crect width='100' height='100' fill='%23f8fafc'/%3e%3ctext x='50' y='62' font-size='40' text-anchor='middle' fill='%23374151'%3e⛪️%3c/text%3e%3c/svg%3e"
    },
    {
        question: "How many US dollars are spent on gasoline per day in the United States?",
        answer: 1130000000,
        category: "",
        explanation: "",
        hint: "In August 2025, the average US price for gasoline was $3.13 per gallon/$0.83 per liter.",
        date: "2025-09-08",
        image: "data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'%3e%3crect width='100' height='100' fill='%23f8fafc'/%3e%3ctext x='50' y='62' font-size='40' text-anchor='middle' fill='%23374151'%3e⛽️%3c/text%3e%3c/svg%3e"
    },
    {
        question: "How many people were alive worldwide in 1925?",
        answer: 1980000000,
        category: "",
        explanation: "",
        hint: "The US population in 1925 was 111.7 million.",
        date: "2025-09-09",
        image: "data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'%3e%3crect width='100' height='100' fill='%23f8fafc'/%3e%3ctext x='50' y='62' font-size='40' text-anchor='middle' fill='%23374151'%3e🌍%3c/text%3e%3c/svg%3e"
    },
    {
        question: "How many assistant, associate, and full professors are there in the US?",
        answer: 518300,
        category: "",
        explanation: "",
        hint: "Stanford University has a total of 1,595 professors.",
        date: "2025-09-10",
        image: "data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'%3e%3crect width='100' height='100' fill='%23f8fafc'/%3e%3ctext x='50' y='62' font-size='40' text-anchor='middle' fill='%23374151'%3e🎓%3c/text%3e%3c/svg%3e"
    },
    {
        question: "What percentage of the Earth's land area is covered by South America?",
        answer: 12,
        category: "",
        explanation: "",
        hint: "The US alone covers around 6.6% of Earth's land area.",
        date: "2025-09-11",
        image: "data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'%3e%3crect width='100' height='100' fill='%23f8fafc'/%3e%3ctext x='50' y='62' font-size='40' text-anchor='middle' fill='%23374151'%3e🌎%3c/text%3e%3c/svg%3e"
    },
    {
        question: "How many oil tankers with a capacity of at least 55,000 metric tons are there?",
        answer: 3219,
        category: "",
        explanation: "",
        hint: "OPEC produced 28 million barrels (4.4 billion liters) of crude oil per day in August 2025.",
        date: "2025-09-12",
        image: "data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'%3e%3crect width='100' height='100' fill='%23f8fafc'/%3e%3ctext x='50' y='62' font-size='40' text-anchor='middle' fill='%23374151'%3e⛴️%3c/text%3e%3c/svg%3e"
    },
    {
        question: "How many professional judges work in Germany's court system?",
        answer: 20793,
        category: "",
        explanation: "",
        hint: "In 2021, German courts convicted around 662,100 defendants by final judgment.",
        date: "2025-09-13",
        image: "data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'%3e%3crect width='100' height='100' fill='%23f8fafc'/%3e%3ctext x='50' y='62' font-size='40' text-anchor='middle' fill='%23374151'%3e👨‍⚖️️%3c/text%3e%3c/svg%3e"
    },
    {
        question: "How many popes have there been in the Catholic Church?",
        answer: 267,
        category: "",
        explanation: "",
        hint: "St. Peter is recognized as the first pope and died around AD 64.",
        date: "2025-09-14",
        image: "data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'%3e%3crect width='100' height='100' fill='%23f8fafc'/%3e%3ctext x='50' y='62' font-size='40' text-anchor='middle' fill='%23374151'%3e️⛪️%3c/text%3e%3c/svg%3e"
    },
    {
        question: "How many visitors does the London Eye observation wheel receive each year?",
        answer: 3500000,
        category: "",
        explanation: "",
        hint: "The London Eye has 32 capsules, each of which holds up to 25 passengers.",
        date: "2025-09-15",
        image: "data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'%3e%3crect width='100' height='100' fill='%23f8fafc'/%3e%3ctext x='50' y='62' font-size='40' text-anchor='middle' fill='%23374151'%3e️🎡%3c/text%3e%3c/svg%3e"
    },
    {
        question: "How much revenue in US dollars did the Harry Potter film series make at the box office?",
        answer: 7700000000,
        category: "",
        explanation: "",
        hint: "The eight Harry Potter films earned $2.39 billion at the US box office.",
        date: "2025-09-16",
        image: "data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'%3e%3crect width='100' height='100' fill='%23f8fafc'/%3e%3ctext x='50' y='62' font-size='40' text-anchor='middle' fill='%23374151'%3e️🍿%3c/text%3e%3c/svg%3e"
    },
    {
        question: "How many MacBooks were sold worldwide in 2024?",
        answer: 19700000,
        category: "",
        explanation: "",
        hint: "25.9% of Apple's total revenue in 2024 came from Europe.",
        date: "2025-09-17",
        image: "data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'%3e%3crect width='100' height='100' fill='%23f8fafc'/%3e%3ctext x='50' y='62' font-size='40' text-anchor='middle' fill='%23374151'%3e️💻%3c/text%3e%3c/svg%3e"
    },
    {
        question: "How many households in the US had an income exceeding $500,000 in 2022?",
        answer: 2478530,
        category: "",
        explanation: "",
        hint: "25.9M US households reported an income between $100,000 and $200,000 in 2022.",
        date: "2025-09-18",
        image: "data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'%3e%3crect width='100' height='100' fill='%23f8fafc'/%3e%3ctext x='50' y='62' font-size='40' text-anchor='middle' fill='%23374151'%3e️🇺🇸%3c/text%3e%3c/svg%3e"
    }
];

// DOM elements
const welcomeScreen = document.getElementById('welcome-screen');
const gameView = document.getElementById('game-view');
const calendarView = document.getElementById('calendar-view');
const playDailyBtn = document.getElementById('play-daily-btn');
const calendarLinkBtn = document.getElementById('calendar-link-btn');
const homeBtn = document.getElementById('home-btn');
const calendarBtn = document.getElementById('calendar-btn');
const dailyChallengeQuestionEl = document.getElementById('daily-challenge-question');
const dailyChallengeDateEl = document.getElementById('daily-challenge-date');
const dailyChallengeStatusEl = document.getElementById('daily-challenge-status');
const dailyChallengeImageContainer = document.getElementById('daily-challenge-image-container');
const dailyChallengeImageEl = document.getElementById('daily-challenge-image');
const calendarMonthsContainer = document.getElementById('calendar-months');
const questionText = document.getElementById('question-text');
const questionCategory = document.getElementById('question-category');
const questionImage = document.getElementById('question-image');
const questionImageContainer = document.getElementById('question-image-container');
const guessCounter = document.getElementById('guess-counter');
const hintContainer = document.getElementById('hint-container');
const hintText = document.getElementById('hint-text');
const hintBody = document.getElementById('hint-body');
const questionMeta = document.getElementById('question-meta');
const sourceBtn = document.getElementById('source-btn');
const sourceModal = document.getElementById('source-modal');
const sourceText = document.getElementById('source-text');
const closeSourceBtn = document.getElementById('close-source-btn');
const gameResult = document.getElementById('game-result');
const resultMessage = document.getElementById('result-message');
const resultEmoji = document.getElementById('result-emoji');
const correctAnswer = document.getElementById('correct-answer');
const guessesContainer = document.getElementById('guesses-container');
const guessInput = document.getElementById('guess-input');
const confidenceInput = document.getElementById('confidence-input');
const confidenceButton = document.getElementById('confidence-button');
const confidenceMenu = document.getElementById('confidence-menu');
const confidenceWrapper = document.querySelector('.confidence-wrapper');
const submitBtn = document.getElementById('submit-btn');
const quickButtons = document.querySelectorAll('.quick-btn');
const sendIcon = `\
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
  <path d="M2 21L23 12L2 3v7l12 2L2 14v7z"/>
</svg>`;
const inputSection = document.getElementById('input-section');

function resetConfidenceInput() {
    if (confidenceInput) confidenceInput.value = '';
    if (confidenceButton) confidenceButton.textContent = '..%';
    if (confidenceMenu) {
        confidenceMenu.querySelectorAll('.selected').forEach(btn => btn.classList.remove('selected'));
    }
}
const newGameSection = document.getElementById('new-game-section');
const newGameBtnInline = document.getElementById('new-game-btn-inline');
const gameOverModal = document.getElementById('game-over-modal');
const modalTitle = document.getElementById('modal-title');
const modalMessage = document.getElementById('modal-message');
const modalAnswer = document.getElementById('modal-answer');
const newGameBtn = document.getElementById('new-game-btn');
const helpBtn = document.getElementById('help-btn');
const statsBtn = document.getElementById('stats-btn');
const helpModal = document.getElementById('help-modal');
const statsModal = document.getElementById('stats-modal');
const questionsModal = document.getElementById('questions-modal');
const strategyTipsBtn = document.getElementById('strategy-tips-btn');
// Hint elements
const hintModalBtn = document.getElementById('hint-modal-btn');
const questionsList = document.getElementById('questions-list');
const closeHelpBtn = document.getElementById('close-help-btn');
const closeStatsBtn = document.getElementById('close-stats-btn');
const closeQuestionsBtn = document.getElementById('close-questions-btn');
const shareBtn = document.getElementById('share-btn');
const shareStatsBtn = document.getElementById('share-stats-btn');
const medianFirstGuessText = document.getElementById('median-first-guess-text');
const firstGuessPercentileText = document.getElementById('first-guess-percentile-text');
const calibrationCheckboxes = document.querySelectorAll('.prob-calibration-checkbox');
const firstGuessCheckbox = document.getElementById('first-guess-checkbox');
const calibrationChart = document.getElementById('calibration-chart');
const calibrationTooltip = document.getElementById('calibration-tooltip');
const calibrationNote = document.querySelector('.calibration-note');
const commentsBtn = document.getElementById('comments-btn');
const commentsSection = document.getElementById('comments-section');
const commentsBackBtn = document.getElementById('comments-back-btn');
const commentsList = document.getElementById('comments-list');
const commentInput = document.getElementById('comment-input');
const commentSubmitBtn = document.getElementById('comment-submit-btn');
const commentCountEl = document.getElementById('comment-count');


// Confidence tooltip
function initConfidenceTooltip() {
    if (!confidenceWrapper) return;
    const dismissed = localStorage.getItem('confidenceTooltipDismissed');
    if (dismissed === 'true') return;
    confidenceWrapper.classList.add('show-tooltip');
    const hideTooltip = () => {
        confidenceWrapper.classList.remove('show-tooltip');
        localStorage.setItem('confidenceTooltipDismissed', 'true');
        document.removeEventListener('mousedown', hideTooltip);
        document.removeEventListener('keydown', hideTooltip);
        document.removeEventListener('touchstart', hideTooltip);
    };
    document.addEventListener('mousedown', hideTooltip, { once: true });
    document.addEventListener('keydown', hideTooltip, { once: true });
    document.addEventListener('touchstart', hideTooltip, { once: true });
}

// Initialize game
function initGame() {
    // Initialize Supabase first
    initSupabase();

    loadStats();
    loadCompletedQuestions();
    loadCalibrationSetting();
    initConfidenceTooltip();

    const initialRoute = parseURL();
    let navigatedFromRoute = false;

    if (initialRoute.view === 'game' && initialRoute.date) {
        navigatedFromRoute = navigateToQuestion(initialRoute.date);
    }

    if (!navigatedFromRoute) {
        const restoredFromSave = loadCurrentGameState();
        if (!restoredFromSave) {
            startNewGame(true);
        }
    }

    refreshDailyChallengeSummary();
    renderCalendar();

    if (navigatedFromRoute) {
        setActiveView('game', { skipURLUpdate: true, force: true });
    } else if (initialRoute.view === 'calendar') {
        setActiveView('calendar', { skipURLUpdate: true, force: true });
    } else if (initialRoute.view === 'game' && initialRoute.date) {
        setActiveView('game', { skipURLUpdate: true, force: true });
        if (currentQuestion) {
            updateURL(currentQuestion.date);
        }
    } else {
        setActiveView('welcome', { force: true });
    }

    setupEventListeners();
    // Always initialize routing; allow it to handle future navigations
    initRouting(true);
}

// Update question display including image
function updateQuestionDisplay(question) {
    questionText.textContent = question.question;
    questionCategory.innerHTML = getQuestionDisplayText(question); // Use innerHTML to allow <span>
    
    // Update question image
    if (question.image) {
        // Hide container initially while loading
        questionImageContainer.style.display = 'none';
        
        // Create a new image element to test loading
        const testImg = new Image();
        testImg.onload = function() {
            // Image loaded successfully, show it
            questionImage.src = question.image;
            questionImage.alt = `Image for ${question.question}`;
            questionImageContainer.style.display = 'block';
        };
        testImg.onerror = function() {
            // Image failed to load, hide container
            console.log('Failed to load image:', question.image);
            questionImageContainer.style.display = 'none';
        };
        testImg.src = question.image;
    } else {
        questionImageContainer.style.display = 'none';
    }

    updateCommentCount();
    subscribeToComments(question.date);
}

// Start a new game
function startNewGame(skipURLUpdate = false) {
    currentQuestion = getCurrentQuestion();

    if (!currentQuestion) {
        console.error('No questions available');
        return;
    }
    
    // Check if this question already has saved progress
    const storageKey = `fermiGameState_${currentQuestion.date}`;
    const existingSavedState = localStorage.getItem(storageKey);
    
    if (existingSavedState) {
        // If there's existing progress, navigate to it instead of starting fresh
        selectQuestion(currentQuestion);
        return;
    }
    
    // Only start fresh if there's no existing progress
    currentGuess = 0;
    gameWon = false;
    gameOver = false;
    
    // Update display
    updateQuestionDisplay(currentQuestion);
    clearGuesses();
    
    // Update page title
    updatePageTitle(currentQuestion);
    
    // Reset display elements
    guessCounter.style.display = 'block';
    hideHint();
    gameResult.style.display = 'none';
    if (questionMeta) {
        questionMeta.style.display = 'none';
    }
    inputSection.style.display = 'block';
    newGameSection.style.display = 'none';
    shareBtn.style.display = 'none'; // Hide share button for new game
    // Nudge attention to the counter on initial start (mobile only)
    triggerShake(guessCounter);
    
    // Reset input
    guessInput.value = '';
    guessInput.disabled = false;
    submitBtn.disabled = false;

    // Auto-focus only on non-touch devices (desktop)
    if (!('ontouchstart' in window) && !navigator.maxTouchPoints) {
        guessInput.focus();
    }

    // Reset confidence input for new game
    resetConfidenceInput();
    updateConfidenceInputVisibility();

    // Update URL to reflect the current question (only if not already navigating)
    if (!isNavigating && !skipURLUpdate && currentView === 'game') {
        updateURL(currentQuestion.date);
    }

    refreshDailyChallengeSummary();
    renderCalendar();
}

// Get current date in YYYY-MM-DD format
function getCurrentDate() {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// Get question for a specific date
function getQuestionForDate(date) {
    return fermiQuestions.find(q => q.date === date);
}

// Format date for display (e.g., "20 July 2025")
function formatDateForDisplay(dateString) {
    const date = new Date(dateString);
    const options = { day: 'numeric', month: 'long', year: 'numeric' };
    return date.toLocaleDateString('en-GB', options);
}

// Get question based on current date and game state
function getCurrentQuestion() {
    const today = getCurrentDate();
    
    // Get all questions sorted by date (newest first)
    const sortedQuestions = fermiQuestions
        .filter(q => q.date <= today)
        .sort((a, b) => new Date(b.date) - new Date(a.date));
    
    // Find the first question that hasn't been completed
    for (let question of sortedQuestions) {
        if (!completedQuestions[question.date]) { // Check if the question is not completed
            return question;
        }
    }
    
    // If all available questions are completed, return the most recent one
    return sortedQuestions.length > 0 ? sortedQuestions[0] : null;
}

// Get question display text
function getQuestionDisplayText(question) {
    const today = getCurrentDate();

    if (question.date === today) {
        return "Question of the Day";
    } else {
        const formattedDate = formatDateForDisplay(question.date);
        return `${formattedDate} <span class='arrow'>></span>`;
    }
}

function getTodaysQuestion() {
    return getQuestionForDate(getCurrentDate());
}

function refreshDailyChallengeSummary() {
    if (!dailyChallengeQuestionEl || !dailyChallengeDateEl) return;

    const todayQuestion = getTodaysQuestion();
    todaysQuestion = todayQuestion || null;

    if (!todayQuestion) {
        dailyChallengeQuestionEl.textContent = 'No daily challenge is available right now.';
        dailyChallengeDateEl.textContent = '';
        if (dailyChallengeStatusEl) {
            dailyChallengeStatusEl.textContent = '';
            dailyChallengeStatusEl.classList.remove('status-won', 'status-lost');
        }
        if (dailyChallengeImageContainer) {
            dailyChallengeImageContainer.style.display = 'none';
        }
        if (playDailyBtn) {
            playDailyBtn.disabled = true;
            playDailyBtn.textContent = 'Unavailable';
        }
        return;
    }

    const todayDate = getCurrentDate();
    const formattedDate = todayQuestion.date === todayDate
        ? 'Today'
        : formatDateForDisplay(todayQuestion.date);

    dailyChallengeDateEl.textContent = formattedDate;
    dailyChallengeQuestionEl.textContent = todayQuestion.question;

    if (dailyChallengeImageContainer) {
        if (todayQuestion.image) {
            dailyChallengeImageContainer.style.display = 'flex';
            if (dailyChallengeImageEl) {
                dailyChallengeImageEl.src = todayQuestion.image;
                dailyChallengeImageEl.alt = `Image for ${todayQuestion.question}`;
            }
        } else {
            dailyChallengeImageContainer.style.display = 'none';
        }
    }

    if (playDailyBtn) {
        playDailyBtn.disabled = false;
    }

    if (dailyChallengeStatusEl) {
        dailyChallengeStatusEl.classList.remove('status-won', 'status-lost');
    }

    const completed = completedQuestions[todayQuestion.date];
    if (completed) {
        if (dailyChallengeStatusEl) {
            dailyChallengeStatusEl.textContent = completed.won ? 'Completed · ✔' : 'Completed · ✘';
            dailyChallengeStatusEl.classList.add(completed.won ? 'status-won' : 'status-lost');
        }
        if (playDailyBtn) {
            playDailyBtn.textContent = 'Review';
        }
    } else {
        if (dailyChallengeStatusEl) {
            dailyChallengeStatusEl.textContent = 'Ready to play';
        }
        if (playDailyBtn) {
            playDailyBtn.textContent = 'Play';
        }
    }
}

function updateHash(newHash) {
    if (window.location.hash !== newHash) {
        window.history.pushState(null, '', newHash);
    }
}

function setActiveView(view, options = {}) {
    const { skipURLUpdate = false, force = false } = options;
    if (!force && currentView === view) {
        if (view === 'calendar') {
            renderCalendar();
        } else if (view === 'welcome') {
            refreshDailyChallengeSummary();
        }
        return;
    }

    currentView = view;

    if (welcomeScreen) {
        welcomeScreen.classList.toggle('active', view === 'welcome');
    }
    if (gameView) {
        gameView.classList.toggle('active', view === 'game');
    }
    if (calendarView) {
        calendarView.classList.toggle('active', view === 'calendar');
    }

    if (!skipURLUpdate) {
        if (view === 'welcome') {
            updateHash('#/welcome');
        } else if (view === 'calendar') {
            updateHash('#/calendar');
        }
    }

    if (view === 'calendar') {
        renderCalendar();
    } else if (view === 'welcome') {
        refreshDailyChallengeSummary();
    } else if (view === 'game') {
        if (guessInput && !('ontouchstart' in window) && !navigator.maxTouchPoints) {
            setTimeout(() => guessInput.focus(), 150);
        }
    }
}

function renderCalendar() {
    if (!calendarMonthsContainer) return;

    const today = getCurrentDate();
    const activeQuestionDate = currentQuestion ? currentQuestion.date : null;
    const sortedQuestions = [...fermiQuestions].sort((a, b) => a.date.localeCompare(b.date));

    if (sortedQuestions.length === 0) {
        calendarMonthsContainer.innerHTML = '<p class="calendar-note">No questions available yet.</p>';
        return;
    }

    const questionsByMonth = new Map();
    sortedQuestions.forEach((question) => {
        const monthKey = question.date.slice(0, 7);
        if (!questionsByMonth.has(monthKey)) {
            questionsByMonth.set(monthKey, []);
        }
        questionsByMonth.get(monthKey).push(question);
    });

    calendarMonthsContainer.innerHTML = '';
    const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    questionsByMonth.forEach((monthQuestions, monthKey) => {
        const monthContainer = document.createElement('div');
        monthContainer.className = 'calendar-month';

        const monthHeader = document.createElement('h3');
        const monthDate = new Date(`${monthKey}-01T00:00:00`);
        monthHeader.textContent = monthDate.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
        monthContainer.appendChild(monthHeader);

        const grid = document.createElement('div');
        grid.className = 'calendar-grid';

        dayLabels.forEach((label) => {
            const labelCell = document.createElement('div');
            labelCell.className = 'calendar-day-label';
            labelCell.textContent = label;
            grid.appendChild(labelCell);
        });

        const questionByDay = new Map();
        monthQuestions.forEach((question) => {
            const dayNumber = parseInt(question.date.slice(8, 10), 10);
            questionByDay.set(dayNumber, question);
        });

        const firstDayIndex = monthDate.getDay();
        for (let i = 0; i < firstDayIndex; i++) {
            const emptyCell = document.createElement('div');
            emptyCell.className = 'calendar-cell empty';
            grid.appendChild(emptyCell);
        }

        const daysInMonth = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0).getDate();
        for (let day = 1; day <= daysInMonth; day++) {
            const questionForDay = questionByDay.get(day);
            if (!questionForDay) {
                const emptyCell = document.createElement('div');
                emptyCell.className = 'calendar-cell empty';
                grid.appendChild(emptyCell);
                continue;
            }

            const cell = document.createElement('button');
            cell.type = 'button';
            cell.className = 'calendar-cell';
            cell.dataset.date = questionForDay.date;

            const isFuture = questionForDay.date > today;
            const completed = completedQuestions[questionForDay.date];
            const isActive = activeQuestionDate === questionForDay.date;

            let labelText = String(day);
            if (completed) {
                const won = !!completed.won;
                labelText = won ? '✔' : '✘';
                cell.classList.add(won ? 'won' : 'lost');
            } else if (isFuture) {
                cell.classList.add('future');
            } else if (questionForDay.date === today) {
                cell.classList.add('today');
            }

            if (isActive) {
                cell.classList.add('active');
                cell.setAttribute('aria-current', 'date');
            } else {
                cell.removeAttribute('aria-current');
            }

            cell.textContent = labelText;

            const accessibleParts = [formatDateForDisplay(questionForDay.date)];
            if (completed) {
                accessibleParts.push(completed.won ? 'completed successfully' : 'completed without success');
            } else if (isFuture) {
                accessibleParts.push('unavailable');
            } else {
                accessibleParts.push('available');
            }
            if (isActive) {
                accessibleParts.push('currently selected');
            }
            cell.setAttribute('aria-label', accessibleParts.join(', '));

            let titleText = accessibleParts[0];
            if (completed && typeof completed.guesses === 'number') {
                const statusText = completed.won ? 'Won' : 'Lost';
                titleText += ` · ${statusText}`;
                if (completed.won) {
                    titleText += ` in ${completed.guesses}/6`;
                }
            }
            cell.title = titleText;

            if (isFuture) {
                cell.disabled = true;
            } else {
                cell.disabled = false;
                cell.addEventListener('click', () => {
                    navigateToQuestion(questionForDay.date);
                });
            }

            grid.appendChild(cell);
        }

        monthContainer.appendChild(grid);
        calendarMonthsContainer.appendChild(monthContainer);
    });
}

// Clear previous guesses
function clearGuesses() {
    guessesContainer.innerHTML = '';
    
    // Create empty guess rows
    for (let i = 0; i < maxGuesses; i++) {
        const guessRow = document.createElement('div');
        guessRow.className = 'guess-row';
        
        const guessField = document.createElement('div');
        guessField.className = 'guess-field empty';
        
        // Set the appropriate text for each guess position
        const guessNumber = i + 1;
        const guessText = getGuessText(guessNumber);
        guessField.textContent = guessText;
        
        const feedbackButton = document.createElement('button');
        feedbackButton.className = 'feedback-button hidden';
        
        guessRow.appendChild(guessField);
        guessRow.appendChild(feedbackButton);
        guessesContainer.appendChild(guessRow);
    }
}

// Helper function to get the text for each guess position
function getGuessText(guessNumber) {
    const guessTexts = {
        1: 'First guess',
        2: 'Second guess',
        3: 'Third guess',
        4: 'Fourth guess',
        5: 'Fifth guess',
        6: 'Sixth guess'
    };
    return guessTexts[guessNumber] || `${guessNumber}th guess`;
}

// Submit a guess
function submitGuess() {
    const guessValue = parseInt(guessInput.value.replace(/[^\d]/g, ''));
    const confidenceValue = confidenceInput ? parseInt(confidenceInput.value) : null;
    let confPercent = null;
    if (calibrationEnabled && confidenceInput) {
        const sanitized = clampConfidencePercent(confidenceValue);
        if (sanitized !== null) {
            confPercent = sanitized;
        }
    }

    if (isNaN(guessValue) || guessValue < 0) {
        alert('Please enter a valid positive number!');
        return;
    }

    currentGuess++;

    // Add guess to display
    addGuessToDisplay(guessValue);
    
    // Check if guess is correct (within 20%)
    const tolerance = currentQuestion.answer * 0.20;
    const isCorrect = Math.abs(guessValue - currentQuestion.answer) <= tolerance;
    
    // Define these variables for all cases (needed for Supabase save)
    let isHigh = false;
    let isClose = false;
    
    if (isCorrect) {
        gameWon = true;
        gameOver = true;
        showFeedback(currentGuess - 1, 'correct', 'WIN');
    } else {
        isHigh = guessValue > currentQuestion.answer;
        
        // Check if guess is within 50% (close but not correct)
        const closeTolerance = currentQuestion.answer * 0.5;
        isClose = Math.abs(guessValue - currentQuestion.answer) <= closeTolerance;
        
        if (isClose) {
            showFeedback(currentGuess - 1, 'close', isHigh ? '↓' : '↑');
        } else {
            showFeedback(currentGuess - 1, isHigh ? 'high' : 'low', isHigh ? '↓' : '↑');
        }

        // Tutorial: auto-show tooltip on first-ever misses
        try {
            const guessRows = guessesContainer.querySelectorAll('.guess-row');
            const currentRow = guessRows[currentGuess - 1];
            const feedbackButton = currentRow.querySelector('.feedback-button');

            if (isClose) {
                const shownClose = localStorage.getItem('fermiTooltipTutorialCloseShown');
                if (!shownClose) {
                    feedbackButton.classList.add('show-tooltip');
                    setTimeout(() => feedbackButton.classList.remove('show-tooltip'), 3200);
                    localStorage.setItem('fermiTooltipTutorialCloseShown', '1');
                }
            } else {
                const shownBasic = localStorage.getItem('fermiTooltipTutorialBasicShown');
                if (!shownBasic) {
                    feedbackButton.classList.add('show-tooltip');
                    setTimeout(() => feedbackButton.classList.remove('show-tooltip'), 3200);
                    localStorage.setItem('fermiTooltipTutorialBasicShown', '1');
                }
            }
        } catch (e) {
            // ignore storage errors
        }
        
        if (currentGuess >= maxGuesses) {
            gameOver = true;
        }
    }
    
    // Clear input
    guessInput.value = '';

    if (calibrationEnabled && confidenceInput) {
        if (confPercent !== null) {
            stats.calibrationData.push({
                confidence: confPercent / 100,
                correct: isCorrect,
                guessNumber: currentGuess
            });
            saveStats();
        }

    }
    
    // Save current game state after each guess
    saveCurrentGameState();
    
    // Save guess to Supabase
    if (supabase && currentUserId && currentQuestion) {
        const guessData = {
            user_id: currentUserId,
            question_date: currentQuestion.date,
            guess_number: currentGuess,
            value: guessValue,
            is_correct: isCorrect,
            is_close: isClose,
            is_high: isHigh,
            confidence_percent: confPercent,
            timestamp: new Date().toISOString()
        };
        
        // Save asynchronously without blocking
        supabase
            .from('guesses')
            .insert(guessData)
            .then(({ error }) => {
                if (error) console.error('Error saving guess to Supabase:', error);
                else console.log('Guess saved to Supabase');
            })
            .catch(err => console.error('Error with Supabase guess save:', err));
    }
    
    // Show hint after 2nd guess if game not won
    if (currentGuess === 2 && !gameWon && currentQuestion.hint) {
        showHint();
    }
    
    // Check if game is over
    if (gameOver) {
        endGame();
    }

    resetConfidenceInput();
    // Hide confidence input after first guess if needed
    updateConfidenceInputVisibility();
    applySubmitButtonState();
}

// Add guess to display
function addGuessToDisplay(guess) {
    const guessRows = guessesContainer.querySelectorAll('.guess-row');
    const currentRow = guessRows[currentGuess - 1];
    const guessField = currentRow.querySelector('.guess-field');
    
    guessField.textContent = formatNumber(guess);
    guessField.classList.remove('empty');
}

// Show feedback for a guess
function showFeedback(guessIndex, type, symbol) {
    const guessRows = guessesContainer.querySelectorAll('.guess-row');
    const currentRow = guessRows[guessIndex];
    const feedbackButton = currentRow.querySelector('.feedback-button');
    
    if (type === 'correct') {
        // Use retro pixelated checkmark SVG for correct answers
        feedbackButton.innerHTML = `
            <svg width="18" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="1" y="10" width="3" height="2" fill="white"/>
                <rect x="1" y="12" width="3" height="2" fill="white"/>
                <rect x="3" y="12" width="3" height="2" fill="white"/>
                <rect x="3" y="14" width="3" height="2" fill="white"/>
                <rect x="5" y="14" width="3" height="2" fill="white"/>
                <rect x="5" y="16" width="3" height="2" fill="white"/>
                <rect x="7" y="12" width="3" height="2" fill="white"/>
                <rect x="7" y="14" width="3" height="2" fill="white"/>
                <rect x="9" y="10" width="3" height="2" fill="white"/>
                <rect x="9" y="12" width="3" height="2" fill="white"/>
                <rect x="11" y="8" width="3" height="2" fill="white"/>
                <rect x="11" y="10" width="3" height="2" fill="white"/>
                <rect x="13" y="6" width="3" height="2" fill="white"/>
                <rect x="13" y="8" width="3" height="2" fill="white"/>
                <rect x="15" y="4" width="3" height="2" fill="white"/>
                <rect x="15" y="6" width="3" height="2" fill="white"/>
                <rect x="17" y="2" width="3" height="2" fill="white"/>
                <rect x="17" y="4" width="3" height="2" fill="white"/>
            </svg>
        `;
    } else {
        feedbackButton.textContent = symbol;
    }
    
    feedbackButton.className = `feedback-button ${type}`;

    // Set tooltip titles for low/high feedback
    if (type === 'low') {
        feedbackButton.setAttribute('data-tooltip', 'Too low! You need to go higher ↑');
        feedbackButton.title = '';
    } else if (type === 'high') {
        feedbackButton.setAttribute('data-tooltip', 'Too high! You need to go lower ↓');
        feedbackButton.title = '';
    } else if (type === 'close') {
        // Use the direction symbol to choose appropriate text
        if (symbol === '↑') {
            feedbackButton.setAttribute('data-tooltip', 'Too low, but within ±50% of the correct answer!');
        } else if (symbol === '↓') {
            feedbackButton.setAttribute('data-tooltip', 'Too high, but within ±50% of the correct answer!');
        } else {
            feedbackButton.removeAttribute('data-tooltip');
        }
        feedbackButton.title = '';
    } else if (type === 'correct') {
        feedbackButton.setAttribute('data-tooltip', "You're within ±20% of the correct answer!");
        feedbackButton.title = '';
    } else {
        feedbackButton.removeAttribute('data-tooltip');
        feedbackButton.title = '';
    }
    
    if (type !== 'correct') {
        currentRow.classList.add('shake');
        setTimeout(() => {
            currentRow.classList.remove('shake');
        }, 500);
    }
}

// Format number with commas
function formatNumber(num) {
    return num.toLocaleString();
}

// Detect small devices for conditional animations
function isSmallDevice() {
    return window.matchMedia('(max-width: 768px)').matches;
}

// Briefly add a 'shake' animation class to an element (mobile only)
function triggerShake(element, durationMs = 500) {
    if (!element || !isSmallDevice()) return;
    element.classList.add('shake');
    setTimeout(() => element.classList.remove('shake'), durationMs);
}

// Brief confetti animation when winning a game
function triggerConfetti(durationMs = 1200, particleCount = 80) {
    const onSmall = isSmallDevice();
    const total = onSmall ? Math.min(particleCount, 40) : particleCount;

    const canvas = document.createElement('canvas');
    canvas.style.position = 'fixed';
    canvas.style.inset = '0';
    canvas.style.width = '100vw';
    canvas.style.height = '100vh';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = '10000';

    const ctx = canvas.getContext('2d');
    const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
    function resizeCanvas() {
        const vw = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
        const vh = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0);
        canvas.width = Math.floor(vw * dpr);
        canvas.height = Math.floor(vh * dpr);
        canvas.style.width = `${vw}px`;
        canvas.style.height = `${vh}px`;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resizeCanvas();
    document.body.appendChild(canvas);

    const colors = ['#e74c3c', '#f1c40f', '#2ecc71', '#3498db', '#9b59b6', '#e67e22'];
    const width = () => canvas.clientWidth;
    const height = () => canvas.clientHeight;

    const particles = [];
    for (let i = 0; i < total; i++) {
        const size = 6 + Math.random() * 6; // 6-12px (slightly larger)
        particles.push({
            x: Math.random() * width(),
            y: -10 - Math.random() * 60,
            vx: (Math.random() - 0.5) * 260, // px/s
            vy: 120 + Math.random() * 240, // px/s
            ax: (Math.random() - 0.5) * 40,   // lateral drift
            ay: 540,                            // gravity px/s^2
            size,
            rotation: Math.random() * Math.PI * 2,
            rotationSpeed: (Math.random() - 0.5) * 6, // rad/s
            color: colors[Math.floor(Math.random() * colors.length)]
        });
    }

    let running = true;
    const start = performance.now();
    let last = start;

    function frame(now) {
        if (!running) return;
        const elapsed = now - start;
        const dt = Math.min(32, now - last) / 1000; // clamp dt to avoid big jumps
        last = now;

        ctx.clearRect(0, 0, width(), height());
        for (let i = 0; i < particles.length; i++) {
            const p = particles[i];
            // update physics
            p.vx += p.ax * dt;
            p.vy += p.ay * dt;
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.rotation += p.rotationSpeed * dt;

            // draw
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rotation);
            ctx.fillStyle = p.color;
            ctx.fillRect(-p.size * 0.5, -p.size * 0.3, p.size, p.size * 0.6);
            ctx.restore();
        }

        if (elapsed < durationMs + 400) {
            requestAnimationFrame(frame);
        } else {
            cleanup();
        }
    }

    function cleanup() {
        running = false;
        try { document.body.removeChild(canvas); } catch (e) { /* noop */ }
    }

    // Resize handler for orientation changes during the brief animation
    const onResize = () => resizeCanvas();
    window.addEventListener('resize', onResize, { passive: true });
    const stopTimer = setTimeout(() => {
        window.removeEventListener('resize', onResize);
        cleanup();
    }, durationMs + 600);

    if (onSmall) {
        setTimeout(() => requestAnimationFrame(frame), 80);
    } else {
        requestAnimationFrame(frame);
    }
}

// Show hint after 2rd guess
function showHint() {
    if (currentQuestion.hint) {
        hintBody.textContent = currentQuestion.hint;
        guessCounter.style.display = 'none';
        hintContainer.style.display = 'block';
        hintContainer.classList.remove('open');
        if (hintModalBtn) {
            hintModalBtn.setAttribute('aria-expanded', 'false');
        }
        triggerShake(hintContainer);
    }
}

// Hide hint
function hideHint() {
    hintContainer.style.display = 'none';
    hintContainer.classList.remove('open');
    if (hintModalBtn) {
        hintModalBtn.setAttribute('aria-expanded', 'false');
    }
}

// End the game
function endGame() {
    guessInput.disabled = true;
    submitBtn.disabled = true;
    
    // Clear saved game state since the game is now completed
    clearCurrentGameState();
    
    // Mark current question as completed and save guesses permanently
    if (currentQuestion && !completedQuestions[currentQuestion.date]) {
        // Gather all guesses and their feedback for permanent storage
        const guessRows = guessesContainer.querySelectorAll('.guess-row');
        const savedGuesses = [];
        
        for (let i = 0; i < currentGuess; i++) {
            const row = guessRows[i];
            const guessField = row.querySelector('.guess-field');
            const feedbackButton = row.querySelector('.feedback-button');
            
            let feedbackType = 'none';
            let feedbackSymbol = '';
            
            if (feedbackButton.classList.contains('correct')) {
                feedbackType = 'correct';
                feedbackSymbol = 'WIN';
            } else if (feedbackButton.classList.contains('close')) {
                feedbackType = 'close';
                feedbackSymbol = feedbackButton.textContent;
            } else if (feedbackButton.classList.contains('high')) {
                feedbackType = 'high';
                feedbackSymbol = feedbackButton.textContent;
            } else if (feedbackButton.classList.contains('low')) {
                feedbackType = 'low';
                feedbackSymbol = feedbackButton.textContent;
            }
            
            savedGuesses.push({
                value: guessField.textContent,
                feedbackType: feedbackType,
                feedbackSymbol: feedbackSymbol
            });
        }
        
        completedQuestions[currentQuestion.date] = {
            question: currentQuestion.question,
            answer: currentQuestion.answer,
            date: currentQuestion.date,
            won: gameWon,
            guesses: currentGuess,
            savedGuesses: savedGuesses
        };
        saveCompletedQuestions();
        
        // Save completed game to Supabase
        if (supabase && currentUserId) {
            const gameData = {
                question_date: currentQuestion.date,
                question_text: currentQuestion.question,
                correct_answer: currentQuestion.answer,
                won: gameWon,
                total_guesses: currentGuess,
                guesses: savedGuesses,
                completed_at: new Date().toISOString()
            };
            
            saveGameToSupabase(gameData);
        }
    }
    
    // Update statistics
    stats.gamesPlayed++;
    if (gameWon) {
        stats.gamesWon++;
        stats.currentStreak++;
        stats.maxStreak = Math.max(stats.maxStreak, stats.currentStreak);
        stats.guessDistribution[currentGuess]++;
    } else {
        stats.currentStreak = 0;
    }
    stats.winRate = Math.round((stats.gamesWon / stats.gamesPlayed) * 100);
    saveStats();
    
    // Hide guess counter, hint, and show game result
    guessCounter.style.display = 'none';
    hideHint();
    gameResult.style.display = 'block';
    if (questionMeta) {
        questionMeta.style.display = 'flex';
    }
    
    // Set result message
    if (gameWon) {
        resultMessage.textContent = `You won!`;
        resultMessage.className = 'result-message won';
        resultEmoji.textContent = '🎉';
        // Brief confetti on win
        triggerConfetti(1200, 80);
    } else {
        resultMessage.textContent = 'You ran out of guesses!';
        resultMessage.className = 'result-message lost';
        resultEmoji.textContent = '🚫';
    }
    
    // Set correct answer
    correctAnswer.innerHTML = `The correct answer was <i>${formatNumber(currentQuestion.answer)}</i>`;
    
    // Average tries inline removed; stats shown in Source modal on demand

    // Check if all available questions are completed
    const today = getCurrentDate();
    const availableQuestions = fermiQuestions.filter(q => q.date <= today);
    const allCompleted = availableQuestions.every(q => completedQuestions[q.date]);
    
    // Hide input section and show new game button
    inputSection.style.display = 'none';
    newGameSection.style.display = 'flex';
    shareBtn.style.display = 'block'; // Show share button after game ends

    // Update button text and functionality based on completion status
    if (allCompleted) {
        newGameBtnInline.textContent = 'Show stats';
        newGameBtnInline.onclick = showStats;
    } else {
        newGameBtnInline.textContent = 'Play more';
        newGameBtnInline.onclick = startNewGame;  
    }

    // Simple scroll to top to ensure good positioning
    window.scrollTo(0, 0);
}

// Start a new game
function startNewGameFromModal() {
    gameOverModal.style.display = 'none';
    startNewGame();
}

// Show help modal
function showHelp() {
    helpModal.style.display = 'block';
}

// Show stats modal
function showStats() {
    updateStatsDisplay();
    statsModal.style.display = 'block';
}

// Update stats display
function updateStatsDisplay() {
    document.getElementById('games-played').textContent = stats.gamesPlayed;
    document.getElementById('games-won').textContent = stats.gamesWon;
    document.getElementById('win-rate').textContent = `${stats.winRate}%`;
    document.getElementById('current-streak').textContent = stats.currentStreak;
    document.getElementById('max-streak').textContent = stats.maxStreak;
    
    // Compute Guess Average (count losses as 7 guesses)
    const guessAverageElement = document.getElementById('guess-average');
    if (guessAverageElement) {
        try {
            const completed = completedQuestions || {};
            const games = Object.values(completed);
            const totalGames = games.length;
            if (totalGames === 0) {
                guessAverageElement.textContent = '0';
            } else {
                const totalRatedGuesses = games.reduce((sum, game) => {
                    const won = !!game.won;
                    const guessesUsed = Number(game.guesses) || 0;
                    return sum + (won ? guessesUsed : 7);
                }, 0);
                const average = totalRatedGuesses / totalGames;
                guessAverageElement.textContent = Number.isInteger(average) ? `${average}` : average.toFixed(1);
            }
        } catch (e) {
            guessAverageElement.textContent = '0';
        }
    }
    
    // Update guess distribution
    const guessDist = stats.guessDistribution || {};
    const maxWins = Math.max(...Object.values(guessDist), 0);
    
    for (let i = 1; i <= 6; i++) {
        const count = guessDist[i] || 0;
        const percentage = maxWins > 0 ? (count / maxWins) * 100 : 0;
        
        const countElement = document.getElementById(`count-${i}`);
        const barElement = document.getElementById(`dist-${i}`);
        
        if (countElement && barElement) {
            countElement.textContent = count;
            barElement.style.width = `${percentage}%`;
        }
    }

    updateCalibrationChart();
}

function showCalibrationTooltip(evt, sampleSize, declared, actual) {
    if (!calibrationTooltip) return;
    const x = (evt.clientX || 0) + 10;
    const y = (evt.clientY || 0) + 10;
    calibrationTooltip.style.left = `${x}px`;
    calibrationTooltip.style.top = `${y}px`;
    calibrationTooltip.innerHTML = `Sample Size: ${sampleSize}<br>Declared: ${declared}%<br>Actual: ${Math.round(actual)}%`;
    calibrationTooltip.style.display = 'block';
}

function hideCalibrationTooltip() {
    if (calibrationTooltip) calibrationTooltip.style.display = 'none';
}

function updateCalibrationChart() {
    const svg = calibrationChart;
    if (!svg) return;

    hideCalibrationTooltip();
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    const width = svg.viewBox.baseVal?.width || svg.width.baseVal.value || 300;
    const height = svg.viewBox.baseVal?.height || svg.height.baseVal.value || 200;
    svg.setAttribute('overflow', 'visible');

    const firstOnly = firstGuessCheckbox && firstGuessCheckbox.checked;
    let data = stats.calibrationData || [];
    if (firstOnly) {
        data = data.filter(d => d.guessNumber === 1);
    }

    const declaredLevels = [10, 20, 30, 40, 50, 60, 70, 80, 90, MAX_CONFIDENCE_PERCENT];
    const bins = declaredLevels.map(() => ({ total: 0, correct: 0 }));
    data.forEach(d => {
        const confFraction = clampConfidenceFraction(d.confidence);
        if (confFraction === null) return;
        const confPercent = Math.round(confFraction * 100);
        const normalized = Math.min(
            MAX_CONFIDENCE_PERCENT,
            Math.max(10, Math.round(confPercent / 10) * 10)
        );
        const idx = declaredLevels.indexOf(normalized);
        if (idx >= 0) {
            bins[idx].total++;
            if (d.correct) bins[idx].correct++;
        }
    });

    const paddingLeft = 50,
        paddingBottom = 60,
        paddingTop = 20,
        paddingRight = 20;
    const plotWidth = width - paddingLeft - paddingRight;
    const plotHeight = height - paddingTop - paddingBottom;

    const ns = 'http://www.w3.org/2000/svg';

    const hasData = bins.some(bin => bin.total > 0);
    if (calibrationNote) {
        calibrationNote.style.display = hasData ? 'none' : 'block';
    }

    // Axes
    const xAxis = document.createElementNS(ns, 'line');
    xAxis.setAttribute('x1', paddingLeft);
    xAxis.setAttribute('y1', height - paddingBottom);
    xAxis.setAttribute('x2', width - paddingRight);
    xAxis.setAttribute('y2', height - paddingBottom);
    xAxis.setAttribute('stroke', '#ccc');
    svg.appendChild(xAxis);

    const yAxis = document.createElementNS(ns, 'line');
    yAxis.setAttribute('x1', paddingLeft);
    yAxis.setAttribute('y1', height - paddingBottom);
    yAxis.setAttribute('x2', paddingLeft);
    yAxis.setAttribute('y2', paddingTop);
    yAxis.setAttribute('stroke', '#ccc');
    svg.appendChild(yAxis);

    // Diagonal line
    const diag = document.createElementNS(ns, 'line');
    diag.setAttribute('x1', paddingLeft);
    diag.setAttribute('y1', height - paddingBottom);
    diag.setAttribute('x2', width - paddingRight);
    diag.setAttribute('y2', paddingTop);
    diag.setAttribute('stroke', '#eee');
    svg.appendChild(diag);

    // Ticks and labels
    const xTickValues = declaredLevels;
    xTickValues.forEach((value) => {
        const x = paddingLeft + (value / 100) * plotWidth;

        const xTick = document.createElementNS(ns, 'line');
        xTick.setAttribute('x1', x);
        xTick.setAttribute('y1', height - paddingBottom);
        xTick.setAttribute('x2', x);
        xTick.setAttribute('y2', height - paddingBottom + 5);
        xTick.setAttribute('stroke', '#ccc');
        svg.appendChild(xTick);

        const xLabel = document.createElementNS(ns, 'text');
        xLabel.setAttribute('x', x + 2);
        xLabel.setAttribute('y', height - paddingBottom + 20);
        xLabel.setAttribute('text-anchor', 'end');
        xLabel.setAttribute('font-size', '10');
        xLabel.setAttribute('transform', `rotate(-45 ${x} ${height - paddingBottom + 15})`);
        xLabel.textContent = `${value}%`;
        svg.appendChild(xLabel);
    });

    const yTickValues = Array.from(new Set([...declaredLevels, 100]))
        .filter((value) => value !== MAX_CONFIDENCE_PERCENT)
        .sort((a, b) => a - b);
    yTickValues.forEach((value) => {
        const y = height - paddingBottom - (value / 100) * plotHeight;

        const yTick = document.createElementNS(ns, 'line');
        yTick.setAttribute('x1', paddingLeft - 5);
        yTick.setAttribute('y1', y);
        yTick.setAttribute('x2', paddingLeft);
        yTick.setAttribute('y2', y);
        yTick.setAttribute('stroke', '#ccc');
        svg.appendChild(yTick);

        const yLabel = document.createElementNS(ns, 'text');
        yLabel.setAttribute('x', paddingLeft - 8);
        yLabel.setAttribute('y', y + 6);
        yLabel.setAttribute('text-anchor', 'end');
        yLabel.setAttribute('font-size', '10');
        yLabel.textContent = `${value}%`;
        svg.appendChild(yLabel);
    });

    // Calibration points
    bins.forEach((bin, i) => {
        if (!bin.total) return;
        const x = paddingLeft + (declaredLevels[i] / 100) * plotWidth;
        const ratio = bin.correct / bin.total;
        const y = height - paddingBottom - ratio * plotHeight;
        const circle = document.createElementNS(ns, 'circle');
        circle.setAttribute('cx', x);
        circle.setAttribute('cy', y);
        circle.setAttribute('r', 3);
        circle.setAttribute('fill', '#3498db');
        const declaredPercent = declaredLevels[i];
        circle.addEventListener('mouseenter', (e) => showCalibrationTooltip(e, bin.total, declaredPercent, ratio * 100));
        circle.addEventListener('mouseleave', hideCalibrationTooltip);
        circle.addEventListener('click', (e) => showCalibrationTooltip(e, bin.total, declaredPercent, ratio * 100));
        circle.addEventListener('touchstart', (e) => {
            const t = e.touches[0];
            if (t) showCalibrationTooltip(t, bin.total, declaredPercent, ratio * 100);
        }, { passive: true });
        svg.appendChild(circle);
    });
}

function clampConfidencePercent(value) {
    if (value === null || value === undefined) return null;
    let numeric = typeof value === 'number' ? value : parseFloat(value);
    if (Number.isNaN(numeric)) return null;
    if (numeric > MAX_CONFIDENCE_PERCENT && numeric <= 100) {
        numeric = MAX_CONFIDENCE_PERCENT;
    } else if (numeric <= 1 && numeric >= 0) {
        numeric = numeric * 100;
    }
    return Math.max(0, Math.min(MAX_CONFIDENCE_PERCENT, numeric));
}

function clampConfidenceFraction(value) {
    if (value === null || value === undefined) return null;
    let numeric = typeof value === 'number' ? value : parseFloat(value);
    if (Number.isNaN(numeric)) return null;
    if (numeric > 1) {
        numeric = numeric / 100;
    }
    return Math.max(0, Math.min(MAX_CONFIDENCE_FRACTION, numeric));
}

function normalizeCalibrationDataEntries(calibrationData) {
    if (!Array.isArray(calibrationData)) return [];
    return calibrationData.map(entry => {
        if (!entry || typeof entry !== 'object') return entry;
        const sanitizedConfidence = clampConfidenceFraction(entry.confidence);
        return sanitizedConfidence === null ? entry : { ...entry, confidence: sanitizedConfidence };
    });
}

// Close modals
function closeModal(modal) {
    modal.style.display = 'none';
}

// Save statistics to localStorage and Supabase
function saveStats() {
    localStorage.setItem('fermiGameStats', JSON.stringify(stats));
    
    // Also save to Supabase
    saveStatsToSupabase(stats);
}

// Load statistics from localStorage
function loadStats() {
    const savedStats = localStorage.getItem('fermiGameStats');
    if (savedStats) {
        try {
            const loadedStats = JSON.parse(savedStats);
            stats = {
                gamesPlayed: loadedStats.gamesPlayed || 0,
                gamesWon: loadedStats.gamesWon || 0,
                winRate: loadedStats.winRate || 0,
                currentStreak: loadedStats.currentStreak || 0,
                maxStreak: loadedStats.maxStreak || 0,
                guessDistribution: loadedStats.guessDistribution || {
                    1: 0,
                    2: 0,
                    3: 0,
                    4: 0,
                    5: 0,
                    6: 0
                },
                calibrationData: loadedStats.calibrationData || []
            };
        } catch (error) {
            console.error('Error loading stats:', error);
            // Reset to default if there's an error
            stats = {
                gamesPlayed: 0,
                gamesWon: 0,
                winRate: 0,
                currentStreak: 0,
                maxStreak: 0,
                guessDistribution: {
                    1: 0,
                    2: 0,
                    3: 0,
                    4: 0,
                    5: 0,
                    6: 0
                },
                calibrationData: []
            };
        }
    }

    const originalDataString = JSON.stringify(stats.calibrationData || []);
    const normalizedData = normalizeCalibrationDataEntries(stats.calibrationData);
    const normalizedDataString = JSON.stringify(normalizedData);
    stats.calibrationData = normalizedData;
    if (originalDataString !== normalizedDataString) {
        saveStats();
    }
}

// Save completed questions to localStorage
function saveCompletedQuestions() {
    localStorage.setItem('fermiCompletedQuestions', JSON.stringify(completedQuestions));
    renderCalendar();
    refreshDailyChallengeSummary();
}

// Load completed questions from localStorage
function loadCompletedQuestions() {
    const savedCompletedQuestions = localStorage.getItem('fermiCompletedQuestions');
    if (savedCompletedQuestions) {
        try {
            completedQuestions = JSON.parse(savedCompletedQuestions);
        } catch (error) {
            console.error('Error loading completed questions:', error);
            completedQuestions = {}; // Reset to default on error
        }
    }
}

function loadCalibrationSetting() {
    const storedCalibration = localStorage.getItem('fermiCalibrationEnabled');
    calibrationEnabled = storedCalibration !== 'false';
    calibrationCheckboxes.forEach(cb => {
        cb.checked = calibrationEnabled;
    });
    const savedFirstOnly = localStorage.getItem('fermiFirstGuessOnly');
    if (firstGuessCheckbox && savedFirstOnly !== null) {
        firstGuessCheckbox.checked = savedFirstOnly === 'true';
    }
    updateConfidenceInputVisibility();
    updateCalibrationChart();
}

function setCalibrationEnabled(enabled) {
    calibrationEnabled = enabled;
    localStorage.setItem('fermiCalibrationEnabled', enabled ? 'true' : 'false');
    calibrationCheckboxes.forEach(cb => {
        cb.checked = enabled;
    });
    updateConfidenceInputVisibility();
}

function updateConfidenceInputVisibility() {
    const firstOnlyActive = firstGuessCheckbox && firstGuessCheckbox.checked;
    const showConfidence = calibrationEnabled && (!firstOnlyActive || currentGuess === 0);

    if (confidenceWrapper) {
        confidenceWrapper.style.display = showConfidence ? '' : 'none';
    }

    if (confidenceInput && confidenceButton) {
        if (showConfidence) {
            const val = confidenceInput.value;
            confidenceButton.textContent = val ? val + '%' : '..%';
        } else {
            resetConfidenceInput();
            confidenceMenu && confidenceMenu.classList.remove('open');
            confidenceButton.setAttribute('aria-expanded', 'false');
        }

        if (isSmallDevice()) {
            confidenceInput.style.display = 'none';
            confidenceButton.style.display = showConfidence ? 'block' : 'none';
        } else {
            confidenceInput.style.display = showConfidence ? 'block' : 'none';
            confidenceButton.style.display = 'none';
            confidenceMenu && confidenceMenu.classList.remove('open');
            confidenceButton.setAttribute('aria-expanded', 'false');
        }
    }
    applySubmitButtonState();
}

function applySubmitButtonState() {
    if (!submitBtn) return;
    if (calibrationEnabled && isSmallDevice()) {
        submitBtn.style.width = '54px';
        submitBtn.innerHTML = sendIcon;
    } else {
        submitBtn.style.width = '';
        submitBtn.textContent = 'Submit';
    }
}

// Save current game state to localStorage and Supabase (per question)
function saveCurrentGameState() {
    if (!currentQuestion) return;
    
    // Gather current guesses and their feedback
    const guessRows = guessesContainer.querySelectorAll('.guess-row');
    const guesses = [];
    
    for (let i = 0; i < currentGuess; i++) {
        const row = guessRows[i];
        const guessField = row.querySelector('.guess-field');
        const feedbackButton = row.querySelector('.feedback-button');
        
        let feedbackType = 'none';
        let feedbackSymbol = '';
        
        if (feedbackButton.classList.contains('correct')) {
            feedbackType = 'correct';
            feedbackSymbol = 'WIN';
        } else if (feedbackButton.classList.contains('close')) {
            feedbackType = 'close';
            feedbackSymbol = feedbackButton.textContent;
        } else if (feedbackButton.classList.contains('high')) {
            feedbackType = 'high';
            feedbackSymbol = feedbackButton.textContent;
        } else if (feedbackButton.classList.contains('low')) {
            feedbackType = 'low';
            feedbackSymbol = feedbackButton.textContent;
        }
        
        guesses.push({
            value: guessField.textContent,
            feedbackType: feedbackType,
            feedbackSymbol: feedbackSymbol
        });
    }
    
    const gameState = {
        question: currentQuestion,
        currentGuess: currentGuess,
        gameWon: gameWon,
        gameOver: gameOver,
        guesses: guesses,
        timestamp: Date.now()
    };
    
    // Store state with question date as key
    const storageKey = `fermiGameState_${currentQuestion.date}`;
    localStorage.setItem(storageKey, JSON.stringify(gameState));
    
    // Also save in-progress game state to Supabase
    if (supabase && currentUserId && !gameOver) {
        const gameData = {
            question_date: currentQuestion.date,
            question_text: currentQuestion.question,
            correct_answer: currentQuestion.answer,
            won: gameWon,
            total_guesses: currentGuess,
            guesses: guesses,
            completed_at: null // Not completed yet
        };
        
        // Save asynchronously without blocking
        saveGameToSupabase(gameData);
    }
}

// Load current game state from localStorage
function loadCurrentGameState() {
    // Try to find the most recent incomplete question with saved state
    const today = getCurrentDate();
    const availableQuestions = fermiQuestions
        .filter(q => q.date <= today)
        .sort((a, b) => new Date(b.date) - new Date(a.date));
    
    for (const question of availableQuestions) {
        // Skip if question is already completed
        if (completedQuestions[question.date]) continue;
        
        // Check if there's saved state for this question
        const storageKey = `fermiGameState_${question.date}`;
        const savedGameState = localStorage.getItem(storageKey);
        if (!savedGameState) continue;
        
        try {
            const gameState = JSON.parse(savedGameState);
            
            // Check if the saved state is not too old (24 hours)
            const maxAge = 24 * 60 * 60 * 1000; // 24 hours
            if (!gameState.question || 
                (Date.now() - gameState.timestamp) > maxAge) {
                localStorage.removeItem(storageKey);
                continue;
            }
            
            // Restore game state
            currentQuestion = gameState.question;
            currentGuess = gameState.currentGuess;
            gameWon = gameState.gameWon;
            gameOver = gameState.gameOver;
            
            // Update display
            updateQuestionDisplay(currentQuestion);
            updatePageTitle(currentQuestion);
            
            // Update URL to reflect the restored question
            updateURL(currentQuestion.date);
            
            // Clear guesses container and restore saved guesses
            clearGuesses();
            restoreGuessesDisplay(gameState.guesses);

            // Update game state display
            if (gameOver) {
                endGameDisplay(); // Call display updates without stats/completion logic
            } else {
                // Show input section for continuing the game
                guessCounter.style.display = 'block';
                gameResult.style.display = 'none';
                inputSection.style.display = 'block';
                newGameSection.style.display = 'none';
                shareBtn.style.display = 'none';

                // Check if hint should be shown (2+ guesses and not won)
                if (currentGuess >= 2 && !gameWon && currentQuestion.hint) {
                    showHint();
                } else {
                    hideHint();
                }

                // Enable input
                guessInput.disabled = false;
                submitBtn.disabled = false;

                // Auto-focus on desktop only
                if (!('ontouchstart' in window) && !navigator.maxTouchPoints) {
                    setTimeout(() => guessInput.focus(), 100);
                }
            }

            // Ensure confidence input visibility matches current state
            updateConfidenceInputVisibility();

            return true;
        } catch (error) {
            console.error('Error loading saved game state for', question.date, ':', error);
            localStorage.removeItem(storageKey);
            continue;
        }
    }
    
    return false;
}

// Clear current game state from localStorage
function clearCurrentGameState() {
    if (currentQuestion) {
        const storageKey = `fermiGameState_${currentQuestion.date}`;
        localStorage.removeItem(storageKey);
    }
}

// Restore guesses display from saved state
function restoreGuessesDisplay(savedGuesses) {
    const guessRows = guessesContainer.querySelectorAll('.guess-row');
    
    savedGuesses.forEach((guess, index) => {
        if (index < guessRows.length) {
            const row = guessRows[index];
            const guessField = row.querySelector('.guess-field');
            const feedbackButton = row.querySelector('.feedback-button');
            
            // Restore guess value
            guessField.textContent = guess.value;
            guessField.classList.remove('empty');
            
            // Restore feedback
            if (guess.feedbackType !== 'none') {
                if (guess.feedbackType === 'correct') {
                    // Use the same checkmark SVG from showFeedback function
                    feedbackButton.innerHTML = `
                        <svg width="18" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <rect x="1" y="10" width="3" height="2" fill="white"/>
                            <rect x="1" y="12" width="3" height="2" fill="white"/>
                            <rect x="3" y="12" width="3" height="2" fill="white"/>
                            <rect x="3" y="14" width="3" height="2" fill="white"/>
                            <rect x="5" y="14" width="3" height="2" fill="white"/>
                            <rect x="5" y="16" width="3" height="2" fill="white"/>
                            <rect x="7" y="12" width="3" height="2" fill="white"/>
                            <rect x="7" y="14" width="3" height="2" fill="white"/>
                            <rect x="9" y="10" width="3" height="2" fill="white"/>
                            <rect x="9" y="12" width="3" height="2" fill="white"/>
                            <rect x="11" y="8" width="3" height="2" fill="white"/>
                            <rect x="11" y="10" width="3" height="2" fill="white"/>
                            <rect x="13" y="6" width="3" height="2" fill="white"/>
                            <rect x="13" y="8" width="3" height="2" fill="white"/>
                            <rect x="15" y="4" width="3" height="2" fill="white"/>
                            <rect x="15" y="6" width="3" height="2" fill="white"/>
                            <rect x="17" y="2" width="3" height="2" fill="white"/>
                            <rect x="17" y="4" width="3" height="2" fill="white"/>
                        </svg>
                    `;
                } else {
                    feedbackButton.textContent = guess.feedbackSymbol;
                }

                feedbackButton.className = `feedback-button ${guess.feedbackType}`;

                // Set tooltip titles for low/high feedback
                if (guess.feedbackType === 'low') {
                    feedbackButton.setAttribute('data-tooltip', 'Too low! You need to go higher ↑');
                    feedbackButton.title = '';
                } else if (guess.feedbackType === 'high') {
                    feedbackButton.setAttribute('data-tooltip', 'Too high! You need to go lower ↓');
                    feedbackButton.title = '';
                } else if (guess.feedbackType === 'close') {
                    if (guess.feedbackSymbol === '↑') {
                        feedbackButton.setAttribute('data-tooltip', 'Too low, but within ±50% of the correct answer!');
                    } else if (guess.feedbackSymbol === '↓') {
                        feedbackButton.setAttribute('data-tooltip', 'Too high, but within ±50% of the correct answer!');
                    } else {
                        feedbackButton.removeAttribute('data-tooltip');
                    }
                    feedbackButton.title = '';
                } else if (guess.feedbackType === 'correct') {
                    feedbackButton.setAttribute('data-tooltip', "You're within ±20% of the correct answer!");
                    feedbackButton.title = '';
                } else {
                    feedbackButton.removeAttribute('data-tooltip');
                    feedbackButton.title = '';
                }
            } else {
                feedbackButton.className = 'feedback-button';
                feedbackButton.innerHTML = '';
                feedbackButton.textContent = '';
                feedbackButton.removeAttribute('data-tooltip');
                feedbackButton.title = '';
            }
        }
    });
}

// Update display elements for ended game (without updating stats)
function endGameDisplay() {
    guessInput.disabled = true;
    submitBtn.disabled = true;
    
    // Hide guess counter, hint, and show game result
    guessCounter.style.display = 'none';
    hideHint();
    gameResult.style.display = 'block';
    if (questionMeta) {
        questionMeta.style.display = 'flex';
    }
    
    // Set result message
    if (gameWon) {
        resultMessage.textContent = `You won!`;
        resultMessage.className = 'result-message won';
        resultEmoji.textContent = '🎉';
        // Brief confetti on win
        triggerConfetti(1200, 80);
    } else {
        resultMessage.textContent = 'You ran out of guesses!';
        resultMessage.className = 'result-message lost';
        resultEmoji.textContent = '🚫';
    }
    
    // Set correct answer
    correctAnswer.innerHTML = `The correct answer was <i>${formatNumber(currentQuestion.answer)}</i>`;
    
    // Average tries inline removed; stats shown in Source modal on demand

    // Check if all available questions are completed
    const today = getCurrentDate();
    const availableQuestions = fermiQuestions.filter(q => q.date <= today);
    const allCompleted = availableQuestions.every(q => completedQuestions[q.date]);
    
    // Hide input section and show new game button
    inputSection.style.display = 'none';
    newGameSection.style.display = 'flex';
    shareBtn.style.display = 'block'; // Show share button after game ends

    // Update button text and functionality based on completion status
    if (allCompleted) {
        newGameBtnInline.textContent = 'Show stats';
        newGameBtnInline.onclick = showStats;
    } else {
        newGameBtnInline.textContent = 'Play more';
        newGameBtnInline.onclick = startNewGame;
    }
}

// Show questions history modal
function showQuestionsHistory() {
    populateQuestionsList();
    questionsModal.style.display = 'block';
}

// Populate questions list
function populateQuestionsList() {
    questionsList.innerHTML = '';
    const today = getCurrentDate();
    
    // Get all questions sorted by date (newest first)
    const sortedQuestions = fermiQuestions
        .filter(q => q.date <= today)
        .sort((a, b) => new Date(b.date) - new Date(a.date));
    
    sortedQuestions.forEach(question => {
        const questionItem = document.createElement('div');
        questionItem.className = 'question-item';
        
        const isCompleted = completedQuestions[question.date] !== undefined;
        const isCurrent = question.date === currentQuestion.date;
        
        if (isCompleted) {
            const completedData = completedQuestions[question.date];
            if (completedData.won) {
                questionItem.classList.add('completed', 'won');
            } else {
                questionItem.classList.add('completed', 'lost');
            }
        } else if (isCurrent) {
            questionItem.classList.add('current');
        }
        
        const questionInfo = document.createElement('div');
        questionInfo.className = 'question-info';
        
        const questionDate = document.createElement('div');
        questionDate.className = 'question-date';
        questionDate.textContent = formatDateForDisplay(question.date);
        
        const questionTextSmall = document.createElement('div');
        questionTextSmall.className = 'question-text-small';
        questionTextSmall.textContent = question.question;
        
        questionInfo.appendChild(questionDate);
        questionInfo.appendChild(questionTextSmall);
        
        const questionStatus = document.createElement('div');
        questionStatus.className = 'question-status';
        
        if (isCompleted) {
            const completedData = completedQuestions[question.date];
            if (completedData.won) {
                questionStatus.textContent = `Won (${completedData.guesses}/6)`;
                questionStatus.classList.add('won');
            } else {
                questionStatus.textContent = 'Lost';
                questionStatus.classList.add('lost');
            }
        } else if (isCurrent) {
            questionStatus.textContent = 'Current';
            questionStatus.classList.add('current');
        } else {
            questionStatus.textContent = 'Available';
            questionStatus.classList.add('available');
        }
        
        questionItem.appendChild(questionInfo);
        questionItem.appendChild(questionStatus);
        
        // Add click handler to select this question
        questionItem.addEventListener('click', () => {
            // Navigate using URL routing (works for both completed and incomplete questions)
            const newURL = `#/${question.date}`;
            window.history.pushState(null, '', newURL);
            navigateToQuestion(question.date);
            closeModal(questionsModal);
        });
        
        questionsList.appendChild(questionItem);
    });
}

// Update the page title based on current question
function updatePageTitle(question) {
    const baseTitle = "Fermi Questions";
    if (question) {
        const today = getCurrentDate();
        if (question.date === today) {
            document.title = `${baseTitle} - Today's Question`;
        } else {
            const formattedDate = formatDateForDisplay(question.date);
            document.title = `${baseTitle} - ${formattedDate}`;
        }
    } else {
        document.title = baseTitle;
    }
}

// Select a specific question
function selectQuestion(question) {
    // Save current game state before switching (if there's an active game)
    if (currentQuestion && currentGuess > 0 && !gameOver && !completedQuestions[currentQuestion.date]) {
        saveCurrentGameState();
    }
    
    currentQuestion = question;
    updateQuestionDisplay(currentQuestion);
    
    // Update page title
    updatePageTitle(currentQuestion);
    
    // Check if this question has been completed before
    const isCompleted = completedQuestions[question.date] !== undefined;
    
    if (isCompleted) {
        // Restore completed question state
        const completedData = completedQuestions[question.date];
        currentGuess = completedData.guesses;
        gameWon = completedData.won;
        gameOver = true;
        
        // Clear guesses and restore saved ones
        clearGuesses();
        if (completedData.savedGuesses) {
            restoreGuessesDisplay(completedData.savedGuesses);
        }
        
        // Show completed game display
        endGameDisplay();
    } else {
        // Check if there's saved state for this incomplete question
        const storageKey = `fermiGameState_${question.date}`;
        const savedGameState = localStorage.getItem(storageKey);
        
        if (savedGameState) {
            try {
                const gameState = JSON.parse(savedGameState);
                
                // Check if saved state is still valid (not too old)
                const maxAge = 24 * 60 * 60 * 1000; // 24 hours
                if (gameState.question && (Date.now() - gameState.timestamp) <= maxAge) {
                    // Restore saved state
                    currentGuess = gameState.currentGuess;
                    gameWon = gameState.gameWon;
                    gameOver = gameState.gameOver;
                    
                    // Clear guesses and restore saved ones
                    clearGuesses();
                    restoreGuessesDisplay(gameState.guesses);
                    
                    if (gameOver) {
                        endGameDisplay();
                    } else {
                        // Show input section for continuing the game
                        guessCounter.style.display = 'block';
                        gameResult.style.display = 'none';
                        if (questionMeta) {
                            questionMeta.style.display = 'none';
                        }
                        inputSection.style.display = 'block';
                        newGameSection.style.display = 'none';
                        shareBtn.style.display = 'none';
                        // Nudge attention to the counter when selecting question
                        triggerShake(guessCounter);
                        
                        // Check if hint should be shown (2+ guesses and not won)
                        if (currentGuess >= 2 && !gameWon && currentQuestion.hint) {
                            showHint();
                        } else {
                            hideHint();
                        }
                        
                        // Enable input
                        guessInput.value = '';
                        guessInput.disabled = false;
                        submitBtn.disabled = false;
                        
                        // Auto-focus on desktop only
                        if (!('ontouchstart' in window) && !navigator.maxTouchPoints) {
                            guessInput.focus();
                        }
                    }
                } else {
                    // Clean up old saved state and start fresh
                    localStorage.removeItem(storageKey);
                    startFreshQuestion();
                }
            } catch (error) {
                console.error('Error loading saved state for question:', error);
                localStorage.removeItem(storageKey);
                startFreshQuestion();
            }
        } else {
            startFreshQuestion();
        }
    }

    // Adjust confidence input based on current guess
    updateConfidenceInputVisibility();

    // Simple scroll to top to ensure good positioning
    window.scrollTo(0, 0);

    // Update URL without triggering navigation
    if (!isNavigating && currentView === 'game') {
        updateURL(question.date);
    }

    refreshDailyChallengeSummary();
    renderCalendar();

    function startFreshQuestion() {
        // Reset game state for new question
        currentGuess = 0;
        gameWon = false;
        gameOver = false;
        
        // Reset display
        guessCounter.style.display = 'block';
        hideHint();
        gameResult.style.display = 'none';
        if (questionMeta) {
            questionMeta.style.display = 'none';
        }
        inputSection.style.display = 'block';
        newGameSection.style.display = 'none';
        shareBtn.style.display = 'none';
        // Nudge attention for fresh selection
        triggerShake(guessCounter);
        
        // Reset input
        guessInput.value = '';
        guessInput.disabled = false;
        submitBtn.disabled = false;

        // Clear guesses
        clearGuesses();

        // Auto-focus on desktop only
        if (!('ontouchstart' in window) && !navigator.maxTouchPoints) {
            guessInput.focus();
        }

        // Show confidence input for first guess only
        updateConfidenceInputVisibility();
    }
}


// Generate share text for current game
function generateGameShareText() {
    if (!gameOver || !currentQuestion) return '';
    
    const guessEmojis = generateGuessEmojis();
    const question = currentQuestion.question;
    
    let shareText = `Fermi Question of the Day: "${question}"\n\n${guessEmojis}\n\nhttps://fermiquestions.org/#/${currentQuestion.date}`;
    
    return shareText;
}

// Generate share text for stats
function generateStatsShareText() {
    const gamesPlayed = stats.gamesPlayed;
    const winRate = stats.winRate;
    const currentStreak = stats.currentStreak;
    const maxStreak = stats.maxStreak;
    
    return `My Fermi Questions Stats:\n🎯 Games Played: ${gamesPlayed}\n📊 Win Rate: ${winRate}%\n🔥 Current Streak: ${currentStreak}\n🏆 Max Streak: ${maxStreak}\n\nhttps://fermiquestions.org`;
}

// Generate emoji representation of guesses
function generateGuessEmojis() {
    const guessRows = guessesContainer.querySelectorAll('.guess-row');
    let emojis = '';
    
    for (let i = 0; i < currentGuess; i++) {
        const row = guessRows[i];
        const feedbackButton = row.querySelector('.feedback-button');
        
        if (feedbackButton.classList.contains('correct')) {
            emojis += '✅'; // Green checkmark for correct
        } else if (feedbackButton.classList.contains('high') || 
                   (feedbackButton.classList.contains('close') && feedbackButton.textContent === '↓')) {
            emojis += '⬇️'; // Too high (whether close or far)
        } else if (feedbackButton.classList.contains('low') || 
                   (feedbackButton.classList.contains('close') && feedbackButton.textContent === '↑')) {
            emojis += '⬆️'; // Too low (whether close or far)
        } else {
            emojis += '❓'; // Fallback for unknown feedback
        }
    }
    
    return emojis;
}

// Handle sharing with Web Share API or clipboard fallback
async function handleShare(text) {
    const isMobile = /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    
    try {
        if (navigator.share && isMobile) {
            await navigator.share({
                text: text
            });
            // No feedback message for native share - OS handles this
        } else {
            // Desktop: copy to clipboard
            await navigator.clipboard.writeText(text);
            showShareFeedback('Copied to clipboard!');
        }
    } catch (error) {
        // Only show clipboard feedback if we're actually copying to clipboard
        if (navigator.share && isMobile) {
            // User cancelled share sheet - do nothing
            return;
        }
        
        // Fallback for older browsers - copy to clipboard
        const textArea = document.createElement('textarea');
        textArea.value = text;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        showShareFeedback('Copied to clipboard!');
    }
}

// Show feedback after sharing
function showShareFeedback(message) {
    const feedback = document.createElement('div');
    feedback.textContent = message;
    feedback.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: #333;
        color: white;
        padding: 12px 20px;
        border-radius: 8px;
        font-family: 'Press Start 2P', monospace;
        font-size: 0.7rem;
        z-index: 10000;
    `;
    
    document.body.appendChild(feedback);
    
    setTimeout(() => {
        document.body.removeChild(feedback);
    }, 2000);
}

// Share current game
function shareGame() {
    const shareText = generateGameShareText();
    if (shareText) {
        handleShare(shareText);
    }
}

// Share stats
function shareStats() {
    const shareText = generateStatsShareText();
    handleShare(shareText);
}

// URL Routing Functions

// Update the URL to reflect the current question
function updateURL(questionDate) {
    if (currentView !== 'game') return;
    const newURL = `#/${questionDate}`;
    if (window.location.hash !== newURL) {
        window.history.pushState(null, '', newURL);
    }
}

// Parse the current URL and return the question date
function parseURL() {
    const hash = window.location.hash || '';

    if (hash === '#/calendar') {
        return { view: 'calendar' };
    }

    const questionMatch = hash.match(/^#\/(\d{4}-\d{2}-\d{2})$/);
    if (questionMatch) {
        return { view: 'game', date: questionMatch[1] };
    }

    if (hash === '#/welcome' || hash === '#/' || hash === '#') {
        return { view: 'welcome' };
    }

    return { view: 'welcome' };
}

// Navigate to a specific question by date
function navigateToQuestion(questionDate) {
    const question = getQuestionForDate(questionDate);

    if (question) {
        // Check if the question is available (not future-dated)
        const today = getCurrentDate();
        if (question.date <= today) {
            isNavigating = true;
            selectQuestion(question);
            isNavigating = false;
            setActiveView('game', { skipURLUpdate: true, force: true });
            if (currentQuestion) {
                updateURL(currentQuestion.date);
            }
            return true;
        }
    }

    // If question not found or not available, redirect to current question
    navigateToCurrentQuestion();
    return false;
}

// Navigate to the current/default question
function navigateToCurrentQuestion() {
    const defaultQuestion = getCurrentQuestion();
    if (defaultQuestion) {
        isNavigating = true;
        selectQuestion(defaultQuestion);
        isNavigating = false;
        setActiveView('game', { skipURLUpdate: true, force: true });
        if (currentQuestion) {
            updateURL(currentQuestion.date);
        }
    } else {
        setActiveView('welcome', { force: true });
    }
}

// Handle browser back/forward navigation
function handlePopState() {
    const route = parseURL();

    if (route.view === 'calendar') {
        setActiveView('calendar', { skipURLUpdate: true, force: true });
        return;
    }

    if (route.view === 'game' && route.date) {
        if (!navigateToQuestion(route.date)) {
            navigateToCurrentQuestion();
        }
        return;
    }

    setActiveView('welcome', { skipURLUpdate: true, force: true });
}

// Initialize routing
function initRouting(skipInitialNavigation = false) {
    // Handle browser navigation
    window.addEventListener('popstate', handlePopState);

    // Skip initial navigation if we restored from saved state
    if (skipInitialNavigation) {
        return;
    }

    // Handle initial page load
    const route = parseURL();
    if (route.view === 'calendar') {
        setActiveView('calendar', { skipURLUpdate: true, force: true });
    } else if (route.view === 'game' && route.date) {
        if (!navigateToQuestion(route.date)) {
            navigateToCurrentQuestion();
        }
    } else {
        setActiveView('welcome', { force: true });
    }
}

// Setup event listeners
function setupEventListeners() {
    // Submit button
    submitBtn.addEventListener('click', submitGuess);
    
    // Enter key in input
    guessInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            submitGuess();
        }
    });
    
    // Format input with commas as user types
    guessInput.addEventListener('input', (e) => {
        const input = e.target;
        const value = input.value.replace(/[^\d]/g, ''); // Keep only digits

        if (value === '') {
            input.value = '';
        } else {
            const number = parseInt(value);
            const formattedValue = formatNumber(number);
            input.value = formattedValue;
        }
    });

    quickButtons.forEach((btn) => {
        btn.addEventListener('click', () => {
            const increment = parseInt(btn.dataset.value, 10);
            const current = parseInt(guessInput.value.replace(/[^\d]/g, ''), 10) || 0;
            const newValue = current + increment;
            guessInput.value = formatNumber(newValue);
            guessInput.focus();
        });
    });

    if (playDailyBtn) {
        playDailyBtn.addEventListener('click', () => {
            const todayQuestion = todaysQuestion || getTodaysQuestion();
            if (todayQuestion) {
                navigateToQuestion(todayQuestion.date);
            } else {
                navigateToCurrentQuestion();
            }
        });
    }

    if (calendarLinkBtn) {
        calendarLinkBtn.addEventListener('click', () => {
            setActiveView('calendar');
        });
    }

    if (homeBtn) {
        homeBtn.addEventListener('click', () => {
            setActiveView('welcome');
        });
    }

    if (calendarBtn) {
        calendarBtn.addEventListener('click', () => {
            setActiveView('calendar');
        });
    }

    // Help button
    helpBtn.addEventListener('click', showHelp);

    // Stats button
    statsBtn.addEventListener('click', showStats);
    
    // Strategy tips (mobile link in guess counter)
    if (strategyTipsBtn) {
        strategyTipsBtn.addEventListener('click', showHelp);
    }

    // Hint accordion toggle (mobile)
    if (hintModalBtn && hintContainer) {
        hintModalBtn.addEventListener('click', () => {
            const isOpen = hintContainer.classList.contains('open');
            if (isOpen) {
                hintContainer.classList.remove('open');
                hintModalBtn.setAttribute('aria-expanded', 'false');
            } else {
                hintContainer.classList.add('open');
                hintModalBtn.setAttribute('aria-expanded', 'true');
            }
        });
    }
    
    // Questions history button (question category)
    questionCategory.addEventListener('click', showQuestionsHistory);

    if (calibrationCheckboxes.length) {
        calibrationCheckboxes.forEach(cb => {
            cb.addEventListener('change', (e) => {
                setCalibrationEnabled(e.target.checked);
            });
        });
    }

    if (firstGuessCheckbox) {
        firstGuessCheckbox.addEventListener('change', () => {
            localStorage.setItem('fermiFirstGuessOnly', firstGuessCheckbox.checked ? 'true' : 'false');
            updateCalibrationChart();
            updateConfidenceInputVisibility();
        });
    }

    // Mobile-only custom confidence dropdown
    if (confidenceButton && confidenceMenu && guessInput) {
        const menuButtons = confidenceMenu.querySelectorAll('button[data-value]');

        const updateSelected = (value) => {
            menuButtons.forEach((btn) => {
                btn.classList.toggle('selected', btn.getAttribute('data-value') === String(value));
            });
        };

        const openMenu = () => {
            confidenceMenu.classList.add('open');
            confidenceButton.setAttribute('aria-expanded', 'true');
            const current = confidenceInput.value || confidenceButton.textContent.replace('%', '');
            updateSelected(current);
        };

        const closeMenu = () => {
            confidenceMenu.classList.remove('open');
            confidenceButton.setAttribute('aria-expanded', 'false');
        };

        const toggleMenu = (e) => {
            if (!isSmallDevice()) return;
            if (confidenceMenu.classList.contains('open')) {
                closeMenu();
            } else if (document.activeElement === guessInput) {
                e.preventDefault();
                guessInput.blur();
                setTimeout(() => {
                    confidenceButton.scrollIntoView({ block: 'center' });
                    openMenu();
                }, 100);
            } else {
                openMenu();
            }
        };

        confidenceButton.addEventListener('click', toggleMenu);

        confidenceMenu.addEventListener('click', (e) => {
            if (e.target.matches('button[data-value]')) {
                const value = e.target.getAttribute('data-value');
                confidenceInput.value = value;
                confidenceButton.textContent = value + '%';
                updateSelected(value);
                closeMenu();
            }
        });

        document.addEventListener('click', (e) => {
            if (confidenceMenu.classList.contains('open') && !confidenceMenu.contains(e.target) && e.target !== confidenceButton) {
                closeMenu();
            }
        });

        updateSelected(confidenceInput.value);
    }
    
    // Source button opens explanation modal
    if (sourceBtn && sourceModal) {
        sourceBtn.addEventListener('click', () => {
            if (currentQuestion && sourceText) {
                const explanation = currentQuestion.explanation || 'No source available for this question as of now. This is a new feature that will be available in the coming days.';
                // Allow simple links if present; otherwise treat as plain text
                sourceText.textContent = '';
                const asHtml = /<a\s|https?:\/\//i.test(explanation);
                if (asHtml) {
                    sourceText.innerHTML = explanation;
                } else {
                    sourceText.textContent = explanation;
                }
                // Reset stats placeholders before fetching
                if (medianFirstGuessText) medianFirstGuessText.textContent = '';
                const playersEl = document.getElementById('source-players-count');
                const winRateEl = document.getElementById('source-win-rate');
                const avgTriesEl = document.getElementById('source-avg-tries');
                if (playersEl) playersEl.textContent = '0';
                if (winRateEl) winRateEl.textContent = '0%';
                if (avgTriesEl) avgTriesEl.textContent = '0';

                // Fetch median first guess
                fetchMedianFirstGuess(currentQuestion.date)
                    .then(median => {
                        if (median != null && medianFirstGuessText) {
                            medianFirstGuessText.textContent = `The median first guess was ${formatNumber(median)}`;
                        }
                    })
                    .catch(() => {/* ignore */});

                // Fetch user's first-guess percentile
                if (firstGuessPercentileText) firstGuessPercentileText.textContent = '';
                fetchFirstGuessPercentile(currentQuestion.date)
                    .then(p => {
                        if (typeof p === 'number' && firstGuessPercentileText) {
                            firstGuessPercentileText.textContent = `Your first guess is in the ${p}th percentile, meaning you've performed as well or better than ${p}% of players.`;
                        }
                    })
                    .catch(() => {/* ignore */});

                // Fetch aggregate stats (players, win rate)
                fetchAverageGuesses(currentQuestion.date)
                    .then(avgData => {
                        if (!avgData) return;
                        if (playersEl && typeof avgData.totalPlayers === 'number') {
                            playersEl.textContent = `${avgData.totalPlayers}`;
                        }
                        if (winRateEl && typeof avgData.winRate === 'number') {
                            winRateEl.textContent = `${avgData.winRate}%`;
                        }
                        if (avgTriesEl && typeof avgData.average === 'number') {
                            const v = avgData.average;
                            avgTriesEl.textContent = Number.isInteger(v) ? `${v}` : v.toFixed(1);
                        }
                    })
                    .catch(() => {/* ignore */});
            }
            sourceModal.style.display = 'block';
        });
    }

    // Accordion toggles
    document.querySelectorAll('.accordion-header').forEach(header => {
        header.addEventListener('click', () => {
            const item = header.parentElement;
            const isOpen = item.classList.contains('open');
            if (isOpen) {
                item.classList.remove('open');
                header.setAttribute('aria-expanded', 'false');
            } else {
                item.classList.add('open');
                header.setAttribute('aria-expanded', 'true');
            }
        });
    });
    
    // Close buttons
    closeHelpBtn.addEventListener('click', () => closeModal(helpModal));
    closeStatsBtn.addEventListener('click', () => closeModal(statsModal));
    closeQuestionsBtn.addEventListener('click', () => closeModal(questionsModal));

    // Comment buttons
    if (commentsBtn) commentsBtn.addEventListener('click', openComments);
    if (commentsBackBtn) commentsBackBtn.addEventListener('click', closeComments);
    if (commentSubmitBtn) {
        commentSubmitBtn.addEventListener('click', async () => {
            const text = commentInput.value.trim();
            if (!text) return;
            await addComment(currentQuestion.date, text);
            commentInput.value = '';
            await loadComments();
        });
    }

    // Share buttons
    shareBtn.addEventListener('click', shareGame);
    shareStatsBtn.addEventListener('click', shareStats);
        
    // Close modals when clicking outside (desktop + mobile)
    [helpModal, statsModal, questionsModal, sourceModal].forEach(modal => {
        ['click', 'touchend'].forEach(event => {
            modal.addEventListener(event, e => e.target === modal && closeModal(modal));
        });
    });
    
    // Prevent modal content clicks from closing modals
    document.querySelectorAll('.modal-content').forEach(content => {
        ['click', 'touchend'].forEach(event => {
            content.addEventListener(event, e => e.stopPropagation());
        });
    });

    // Close source modal via button
    if (closeSourceBtn && sourceModal) {
        closeSourceBtn.addEventListener('click', () => closeModal(sourceModal));
    }
}

if (calibrationChart) {
    calibrationChart.addEventListener('mouseleave', hideCalibrationTooltip);
}

document.addEventListener('click', (e) => {
    if (!e.target.closest('#calibration-chart')) hideCalibrationTooltip();
});

// Initialize the game when the page loads
window.addEventListener('resize', updateConfidenceInputVisibility);
document.addEventListener('DOMContentLoaded', initGame);
