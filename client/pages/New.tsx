import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { Heading, Label, Button, Input, Select, TextArea } from '../components/Elements';
import SearchInput from '../components/SearchInput'
import API from '../api';
import { objectFromForm } from '../utils';
import { Airline, Airport, User } from '../models';
import ConfigStorage from '../storage/configStorage';
import FetchConnection from '../components/FetchConnection';

// Module-level option lists and traveler fields component to avoid remounting on each render
const seatOptions = [
    { text: "Choose", value: "" },
    { text: "Aisle", value: "aisle" },
    { text: "Middle", value: "middle" },
    { text: "Window", value: "window" }
];
const sideOptions = [
    { text: "Choose", value: "" },
    { text: "Left", value: "left" },
    { text: "Right", value: "right" },
    { text: "Center", value: "center" }
];
const classOptions = [
    { text: "Choose", value: "" },
    { text: "Private", value: "private" },
    { text: "First", value: "first" },
    { text: "Business", value: "business" },
    { text: "Economy+", value: "economy+" },
    { text: "Economy", value: "economy" }
];
const purposeOptions = [
    { text: "Choose", value: "" },
    { text: "Leisure", value: "leisure" },
    { text: "Business", value: "business" },
    { text: "Crew", value: "crew" },
    { text: "Other", value: "other" }
];

function TravelerFields({ username, values, onChange }: {
    username: string,
    values: { seat?: string; aircraftSide?: string; ticketClass?: string; purpose?: string; notes?: string } | undefined,
    onChange: (username: string, field: 'seat'|'aircraftSide'|'ticketClass'|'purpose'|'notes', value: string) => void
}) {
    return (
        <>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 mt-2">
                <div>
                    <Label text="Seat Type" />
                    <Select
                        value={values?.seat || ''}
                        onChange={(e) => onChange(username, 'seat', e.target.value)}
                        options={seatOptions}
                    />
                </div>
                <div>
                    <Label text="Aircraft Side" />
                    <Select
                        value={values?.aircraftSide || ''}
                        onChange={(e) => onChange(username, 'aircraftSide', e.target.value)}
                        options={sideOptions}
                    />
                </div>
                <div>
                    <Label text="Class" />
                    <Select
                        value={values?.ticketClass || ''}
                        onChange={(e) => onChange(username, 'ticketClass', e.target.value)}
                        options={classOptions}
                    />
                </div>
                <div>
                    <Label text="Purpose" />
                    <Select
                        value={values?.purpose || ''}
                        onChange={(e) => onChange(username, 'purpose', e.target.value)}
                        options={purposeOptions}
                    />
                </div>
            </div>
            <div className="mt-2">
                <Label text="Notes" />
                <textarea
                    rows={5}
                    className="w-full px-1 mb-4 bg-white rounded-none outline-none font-mono box-border border-2 border-gray-200 focus:border-primary-400"
                    name={`notes__${username}`}
                    defaultValue={values?.notes || ''}
                    maxLength={150}
                    onChange={(e) => onChange(username, 'notes', e.target.value)}
                />
            </div>
        </>
    );
}

export default function New() {
    const navigate = useNavigate();

    const [date, setDate] = useState<string>((new Date()).toISOString().substring(0, 10));
    const [flightNumber, setFlightNumber] = useState<string>();
    const [origin, setOrigin] = useState<Airport>();
    const [destination, setDestination] = useState<Airport>();
    const [airline, setAirline] = useState<Airline>();
    const [connection, setConnection] = useState<number>();

    // delegation (admin-only for now)
    const [currentUser, setCurrentUser] = useState<User | undefined>();
    const [allUsers, setAllUsers] = useState<string[] | undefined>();
    const [selectedUsernames, setSelectedUsernames] = useState<string[]>([]);
    const [perUser, setPerUser] = useState<Record<string, {
        seat?: string;
        aircraftSide?: string;
        ticketClass?: string;
        purpose?: string;
        notes?: string;
    }>>({});

    const localAirportTime = ConfigStorage.getSetting("localAirportTime");

    useEffect(() => {
        // Get current user; if admin, load users list
        API.get('/users/me').then((me: User) => {
            setCurrentUser(me);
            setSelectedUsernames([me.username]);
            setPerUser((prev) => ({ ...prev, [me.username]: prev[me.username] || {} }));
            if (me.isAdmin) {
                API.get('/users').then((users: string[]) => setAllUsers(users));
            }
        });
    }, []);

    const toggleSelected = (username: string) => {
        setSelectedUsernames((prev) => {
            const isSelected = prev.includes(username);
            if (isSelected) {
                // prevent empty selection; keep at least one user selected
                if (prev.length === 1) return prev;
                return prev.filter(u => u !== username);
            }

            // Prefill newly-added user's traveler fields from current user's (or the first selected)
            setPerUser((prevPU) => {
                if (prevPU[username]) return prevPU;
                let templateUser: string | undefined = undefined;
                if (currentUser && prevPU[currentUser.username]) templateUser = currentUser.username;
                else if (prev.length > 0) templateUser = prev[0];

                const template = templateUser ? prevPU[templateUser] : {};
                return { ...prevPU, [username]: { ...(template || {}) } };
            });

            return [...prev, username];
        });
    };

    const setPerUserField = (username: string, field: 'seat'|'aircraftSide'|'ticketClass'|'purpose'|'notes', value: string) => {
        setPerUser((prev) => ({
            ...prev,
            [username]: { ...(prev[username] || {}), [field]: value || undefined },
        }));
    };

    

    const postFlight = async (event) => {
        event.preventDefault();

        const flightData = objectFromForm(event);

        if (flightData === null) {
            return;
        }

        // Build a single payload for multi-user creation
        const users = selectedUsernames.map((u) => {
            const noteKey = `notes__${u}`;
            const notes = (flightData as any)[noteKey] ?? perUser[u]?.notes;
            return {
            username: currentUser?.isAdmin ? u : undefined,
            seat: perUser[u]?.seat,
            aircraftSide: perUser[u]?.aircraftSide,
            ticketClass: perUser[u]?.ticketClass,
            purpose: perUser[u]?.purpose,
            notes,
        };
        });

        const payload = { ...flightData, users };
        const result = await API.post(`/flights?timezones=${localAirportTime}`, payload);
        const ids: number[] = Array.isArray(result) ? result : [result];

        // pick current user's ID if present; else first
        const idx = selectedUsernames.findIndex(u => u === currentUser?.username);
        const targetId = idx >= 0 ? ids[idx] : ids[0];
        navigate(`/flights?id=${targetId}`);
    };

    const attemptFetchFlight = async () => {
        API.getRemote(`https://api.adsbdb.com/v0/callsign/${flightNumber}`)
        .then(async (data: Object) => {
            const originICAO = data["response"]["flightroute"]["origin"]["icao_code"];
            const destinationICAO = data["response"]["flightroute"]["destination"]["icao_code"];
            const airlineICAO = data["response"]["flightroute"]["airline"]["icao"];

            const origin = await API.get(`/airports/${originICAO}`);
            const destination= await API.get(`/airports/${destinationICAO}`);
            const airline = await API.get(`/airlines/${airlineICAO}`)

            setOrigin({...origin});
            setDestination({...destination});
            setAirline({ ...airline });
        });
    };

    return (
        <>
            <Heading text="New Flight" />

            <form onSubmit={postFlight}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4">
                    <div className="container">
                        <Label text="Origin" required />
                        <SearchInput name="origin"
                                     type="airports"
                                     value={origin}
                                     onSelect={(airport: Airport) => setOrigin(airport)} />
                        <br />
                        <Label text="Destination" required />
                        <SearchInput name="destination"
                                     type="airports"
                                     value={destination}
                                     onSelect={(airport: Airport) => setDestination(airport)} />
                        <br />
                        <Label text="Date" required />
                        <Input
                            type="date"
                            name="date"
                            defaultValue={(new Date()).toISOString().substring(0, 10)}
                            onChange={(e) => setDate(e.target.value)}
                            required
                        />

                        <br />
                        <Label text="Departure Time" />
                        <Input
                            type="time"
                            name="departureTime"
                        />
                        <br />
                        <Label text="Arrival Time" />
                        <Input
                            type="time"
                            name="arrivalTime"
                        />
                        <br />
                        <Label text="Arrival Date" />
                        <Input
                            type="date"
                            name="arrivalDate"
                        />
                    </div>

                    <div className="container">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                                <Label text="Airplane" />
                                <Input type="text" name="airplane" placeholder="B738" maxLength={16} />
                            </div>
                            <div>
                                <Label text="Tail Number" />
                                <Input type="text" name="tailNumber" placeholder="EI-DCL" maxLength={16} />
                            </div>
                        </div>

                        <br />
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
                            <div>
                                <Label text="Airline" />
                                <SearchInput name="airline"
                                             type="airlines"
                                             value={airline}
                                             onSelect={(airline: Airline) => setAirline(airline)} />
                            </div>
                            <div className="whitespace-nowrap">
                                <Label text="Flight Number" />
                                <Input
                                    type="text"
                                    name="flightNumber"
                                    placeholder="FR2460"
                                    maxLength={7}
                                    onChange={(e) => setFlightNumber(e.target.value)}
                                />
                            </div>
                            <div className="h-10 flex items-center">
                                <Button text="Fetch" onClick={attemptFetchFlight} disabled={!flightNumber} />
                            </div>
                        </div>
                        <div>
                            <Label text="Connection" />
                            <FetchConnection name="connection"
                                             date={date}
                                             origin={origin?.icao}
                                             destination={destination?.icao}
                                             value={connection}
                                             onFetched={(c: number) => setConnection(c)} />
                        </div>
                    </div>
                </div>

                {currentUser?.isAdmin && allUsers && (
                    <div className="px-4 pb-2">
                        <Label text="Add flight for users" />
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 mt-2">
                            {[...(allUsers || [])].sort((a, b) => {
                                if (currentUser && a === currentUser.username) return -1;
                                if (currentUser && b === currentUser.username) return 1;
                                return a.localeCompare(b);
                            }).map((u) => (
                                <label key={u} className="flex items-center gap-2">
                                    <input
                                        type="checkbox"
                                        name="usernames_checkbox"
                                        checked={selectedUsernames.includes(u)}
                                        onChange={() => toggleSelected(u)}
                                    />
                                    <span>{u}</span>
                                </label>
                            ))}
                        </div>
                        {/* Per-user traveler inputs */}
                        <div className="mt-4 space-y-4">
                            {[...selectedUsernames].sort((a, b) => {
                                if (currentUser && a === currentUser.username) return -1;
                                if (currentUser && b === currentUser.username) return 1;
                                return a.localeCompare(b);
                            }).map((u) => (
                                <div key={u} className="container">
                                    <div className="font-medium mb-2">Traveler: {u}</div>
                                    <TravelerFields username={u} values={perUser[u]} onChange={setPerUserField} />
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {!currentUser?.isAdmin && currentUser && (
                    <div className="px-4 pb-2">
                        <div className="container">
                        <Label text="Traveler Details" />
                        <TravelerFields username={currentUser.username} values={perUser[currentUser.username]} onChange={setPerUserField} />
                        </div>
                    </div>
                )}

                <div className="px-4 pb-4">
                    <Button
                        text="Done"
                        submit
                    />
                </div>
            </form>
        </>
    );
}
