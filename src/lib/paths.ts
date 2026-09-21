import { collection, doc, type Firestore } from "firebase/firestore";

// Every helper takes the Firestore instance so the same paths serve the browser SDK
// (live listeners) and the FirebaseServerApp inside server actions (all writes).

export const userDoc = (db: Firestore, uid: string) => doc(db, "users", uid);
export const inviteCodeDoc = (db: Firestore, code: string) =>
  doc(db, "inviteCodes", code);

export const houseDoc = (db: Firestore, houseId: string) => doc(db, "houses", houseId);
export const housesCol = (db: Firestore) => collection(db, "houses");

export const membersCol = (db: Firestore, houseId: string) =>
  collection(db, "houses", houseId, "members");
export const memberDoc = (db: Firestore, houseId: string, uid: string) =>
  doc(db, "houses", houseId, "members", uid);

export const machinesCol = (db: Firestore, houseId: string) =>
  collection(db, "houses", houseId, "machines");
export const machineDoc = (db: Firestore, houseId: string, machineId: string) =>
  doc(db, "houses", houseId, "machines", machineId);

export const bookingsCol = (db: Firestore, houseId: string) =>
  collection(db, "houses", houseId, "bookings");
export const bookingDoc = (db: Firestore, houseId: string, bookingId: string) =>
  doc(db, "houses", houseId, "bookings", bookingId);

/**
 * One document per browser that asked for notifications. House-scoped rather than nested
 * under a member, because sending a notification means reading someone else's tokens.
 */
export const devicesCol = (db: Firestore, houseId: string) =>
  collection(db, "houses", houseId, "devices");
export const deviceDoc = (db: Firestore, houseId: string, deviceId: string) =>
  doc(db, "houses", houseId, "devices", deviceId);

export const joinRequestsCol = (db: Firestore, houseId: string) =>
  collection(db, "houses", houseId, "joinRequests");
export const joinRequestDoc = (db: Firestore, houseId: string, uid: string) =>
  doc(db, "houses", houseId, "joinRequests", uid);

export const sessionsCol = (db: Firestore, houseId: string) =>
  collection(db, "houses", houseId, "sessions");
export const sessionDoc = (db: Firestore, houseId: string, sessionId: string) =>
  doc(db, "houses", houseId, "sessions", sessionId);

/**
 * One document per bookable 15-minute slot. Creating them inside a transaction is what
 * actually makes overlapping bookings impossible: the SDK cannot run queries in a
 * transaction, but it can read and write these deterministically named documents.
 */
export const slotDoc = (db: Firestore, houseId: string, slotId: string) =>
  doc(db, "houses", houseId, "slots", slotId);
