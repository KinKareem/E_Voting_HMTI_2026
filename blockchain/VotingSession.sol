// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title VotingSession
 * @notice Kontrak pemilihan Ketua HMTI. Mencatat:
 *         1. sesi voting: kapan DIBUKA dan DITUTUP, serta wallet admin yang melakukannya;
 *         2. daftar nomor paslon yang sah (dikunci saat sesi dibuka);
 *         3. suara anonim yang dikirim relayer, dan hitungan per paslon.
 *
 * Aturan (dijaga oleh kontrak, bukan oleh aplikasi):
 *  1. Hanya OWNER (wallet yang mendeploy) yang dapat membuka/menutup sesi dan
 *     mengganti relayer.
 *  2. Urutan status satu arah: NotStarted -> Open -> Closed. Penutupan PERMANEN.
 *  3. Nomor paslon yang sah ditetapkan sekali, saat sesi dibuka. Setelah itu tidak
 *     bisa diubah.
 *  4. Hanya RELAYER yang dapat mengirim suara, dan hanya saat sesi Open.
 *  5. Setiap suara membawa ID acak. ID yang sudah pernah dihitung dilewati, sehingga
 *     pengiriman ulang (misal relayer mati di tengah jalan) tidak pernah
 *     menghitung suara dua kali.
 *  6. Kontrak tidak menyimpan identitas pemilih; hanya nomor paslon dan ID acak.
 *
 * Catatan: seluruh data di blockchain publik dapat dibaca siapa saja, termasuk
 * hitungan sementara selama voting berlangsung.
 */
contract VotingSession {
    enum Status {
        NotStarted, // 0 - sesi belum dibuka
        Open, //       1 - sesi sedang berlangsung
        Closed //      2 - sesi sudah ditutup (permanen)
    }

    uint256 public constant MAX_CANDIDATES = 50;
    uint256 public constant MAX_BATCH = 100;

    /// Wallet admin yang mendeploy kontrak. Tidak dapat diganti.
    address public immutable owner;
    /// Wallet yang boleh mengirim suara. Dapat diganti owner selama sesi belum Closed.
    address public relayer;

    Status public status;

    address public openedBy;
    uint256 public openedAt; // unix timestamp (detik) waktu blok saat dibuka
    address public closedBy;
    uint256 public closedAt; // unix timestamp (detik) waktu blok saat ditutup

    uint8[] private candidateNumbers;
    mapping(uint8 => bool) public isCandidate;
    mapping(uint8 => uint256) public votesFor;
    uint256 public totalVotes;
    mapping(bytes32 => bool) public voteCounted;

    event SessionOpened(address indexed admin, uint256 timestamp);
    event SessionClosed(address indexed admin, uint256 timestamp);
    event CandidatesRegistered(uint8[] numbers);
    event RelayerChanged(address indexed previousRelayer, address indexed newRelayer);
    event VotesCast(uint256 accepted, uint256 duplicates, uint256 totalVotes);

    /// Pemanggil bukan owner kontrak.
    error NotOwner();
    /// Pemanggil bukan relayer terdaftar.
    error NotRelayer();
    /// Aksi tidak diizinkan pada status saat ini.
    error InvalidState(Status current);
    /// Daftar nomor paslon kosong, terlalu banyak, berisi 0, atau berisi nomor ganda.
    error InvalidCandidates();
    /// Nomor paslon pada suara tidak terdaftar.
    error InvalidCandidate(uint8 number);
    /// Batch kosong, panjang array berbeda, atau lebih dari MAX_BATCH.
    error InvalidBatch();
    /// Alamat nol tidak diperbolehkan.
    error ZeroAddress();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address initialRelayer) {
        if (initialRelayer == address(0)) revert ZeroAddress();
        owner = msg.sender;
        relayer = initialRelayer;
        emit RelayerChanged(address(0), initialRelayer);
    }

    /// Mengganti relayer (misal wallet lama hilang). Tidak bisa setelah sesi Closed.
    function setRelayer(address newRelayer) external onlyOwner {
        if (status == Status.Closed) revert InvalidState(status);
        if (newRelayer == address(0)) revert ZeroAddress();

        emit RelayerChanged(relayer, newRelayer);
        relayer = newRelayer;
    }

    /// Membuka sesi sekaligus menetapkan nomor paslon yang sah. Hanya sekali.
    function openSession(uint8[] calldata numbers) external onlyOwner {
        if (status != Status.NotStarted) revert InvalidState(status);

        uint256 count = numbers.length;
        if (count == 0 || count > MAX_CANDIDATES) revert InvalidCandidates();

        for (uint256 i = 0; i < count; i++) {
            uint8 number = numbers[i];
            if (number == 0 || isCandidate[number]) revert InvalidCandidates();
            isCandidate[number] = true;
            candidateNumbers.push(number);
        }

        status = Status.Open;
        openedBy = msg.sender;
        openedAt = block.timestamp;

        emit CandidatesRegistered(numbers);
        emit SessionOpened(msg.sender, block.timestamp);
    }

    /// Mengirim sekumpulan suara anonim. ids[i] = ID acak suara, numbers[i] = nomor paslon.
    function castVotes(bytes32[] calldata ids, uint8[] calldata numbers) external {
        if (msg.sender != relayer) revert NotRelayer();
        if (status != Status.Open) revert InvalidState(status);

        uint256 count = ids.length;
        if (count == 0 || count != numbers.length || count > MAX_BATCH) revert InvalidBatch();

        uint256 accepted = 0;
        for (uint256 i = 0; i < count; i++) {
            if (voteCounted[ids[i]]) continue; // sudah pernah dihitung: lewati

            uint8 number = numbers[i];
            if (!isCandidate[number]) revert InvalidCandidate(number);

            voteCounted[ids[i]] = true;
            votesFor[number] += 1;
            accepted += 1;
        }

        totalVotes += accepted;
        emit VotesCast(accepted, count - accepted, totalVotes);
    }

    /// Menutup sesi voting secara permanen. Hanya bisa dari status Open.
    function closeSession() external onlyOwner {
        if (status != Status.Open) revert InvalidState(status);

        status = Status.Closed;
        closedBy = msg.sender;
        closedAt = block.timestamp;

        emit SessionClosed(msg.sender, block.timestamp);
    }

    /// Jumlah paslon yang terdaftar.
    function candidateCount() external view returns (uint256) {
        return candidateNumbers.length;
    }

    /// Hitungan suara semua paslon: numbers[i] memperoleh counts[i] suara.
    function getResults() external view returns (uint8[] memory numbers, uint256[] memory counts) {
        uint256 count = candidateNumbers.length;
        numbers = new uint8[](count);
        counts = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
            numbers[i] = candidateNumbers[i];
            counts[i] = votesFor[candidateNumbers[i]];
        }
    }
}
