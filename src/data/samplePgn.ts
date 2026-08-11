/**
 * Sample PGN strings for testing the blunder detector.
 *
 * Eval convention (standard PGN): positive = White is better, negative = Black is better.
 *
 * Blunder examples in this game:
 *  - Move 9  (White):  eval drops from +3.5 → -0.2  (drop = 3.7 pawns for White) → eval_drop
 *  - Move 14 (White):  marked ?? AND eval drops from +2.0 → -1.2 (drop = 3.2 pawns) → annotation_and_eval
 *  - Move 17 (Black):  marked ?? AND eval rises from -1.0 → +2.8 (drop = 3.8 for Black) → annotation_and_eval
 *  - Move 22 (White):  marked ?? only (no eval tags) → annotation
 */
export const SAMPLE_PGN = `[Event "Test Game"]
[Site "chess.com"]
[Date "2024.01.01"]
[White "Player1"]
[Black "Player2"]
[Result "0-1"]
[WhiteElo "1500"]
[BlackElo "1520"]

1. e4 { [%eval 0.17] } 1... e5 { [%eval 0.17] }
2. Nf3 { [%eval 0.20] } 2... Nc6 { [%eval 0.18] }
3. Bc4 { [%eval 0.25] } 3... Nf6 { [%eval 0.22] }
4. Ng5 { [%eval 0.55] } 4... d5 { [%eval 0.43] }
5. exd5 { [%eval 0.50] } 5... Na5 { [%eval 0.47] }
6. Bb5+ { [%eval 0.60] } 6... c6 { [%eval 0.55] }
7. dxc6 { [%eval 3.50] } 7... bxc6 { [%eval 3.45] }
8. Be2 { [%eval 3.50] } 8... h6 { [%eval 3.40] }
9. Nf3 { [%eval -0.20] } 9... e4 { [%eval -0.25] }
10. Ne5 { [%eval -0.30] } 10... Qd4 { [%eval -0.40] }
11. Nxc6 { [%eval -0.50] } 11... Nxc6 { [%eval -0.55] }
12. d3 { [%eval 2.00] } 12... exd3 { [%eval 1.90] }
13. cxd3 { [%eval 2.00] } 13... Bc5 { [%eval 1.95] }
14. O-O?? { [%eval -1.20] } 14... Bxf2+ { [%eval -1.30] }
15. Rxf2 { [%eval -1.20] } 15... Qxf2+ { [%eval -1.35] }
16. Kh1 { [%eval -1.00] } 16... Ng4 { [%eval -1.05] }
17. d4 { [%eval -1.00] } 17... Nxh2?? { [%eval 2.80] }
18. Kxh2 { [%eval 2.75] } 18... Qxg2+ { [%eval 2.80] }
19. Kh1 { [%eval #3] } 19... Qg1+ { [%eval #2] }
20. Rxg1 { [%eval #1] } 20... Nf2# { [%eval #0] }
21. Kh2 { [%eval #-1] } 21... Rxg1 { [%eval #-2] }
22. Qxg1?? { [%eval #-1] } 22... Rg8 { [%eval #-3] } 0-1`;

/**
 * A minimal PGN with only annotation-based blunders (no eval tags).
 */
export const ANNOTATION_ONLY_PGN = `[Event "Annotation Only"]
[White "Alice"]
[Black "Bob"]
[Result "*"]

1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6 4. Ng5 d5 5. exd5 Nxd5??
6. Nxf7?? Kxf7 7. Qf3+ Ke6 8. Nc3 Ncb4 *`;



